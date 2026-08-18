import type { Annotation, AnnotationPoint } from '$lib/types/annotations.js';
import {
	ANNOTATION_REFERENCE_HEIGHT,
	HIGHLIGHTER_ALPHA,
	HIGHLIGHTER_WIDTH_SCALE,
} from '$lib/types/annotations.js';

/**
 * Canvas drawing for annotations, kept free of any DOM lookups.
 *
 * The same code paints the live preview and rasterises the PNGs the exporter
 * composites, so the two renderers cannot drift the way the CSS preview and the
 * FFmpeg export did for Motion FX. Everything here takes an explicit surface
 * size and reads nothing from the document.
 */

/**
 * The slice of the 2D context this module touches.
 *
 * Both `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D`
 * satisfy it, and a plain recorder object satisfies it in tests — which is what
 * lets the drawing logic be tested without a canvas implementation.
 */
export interface AnnotationContext {
	save(): void;
	restore(): void;
	beginPath(): void;
	closePath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	rect(x: number, y: number, w: number, h: number): void;
	ellipse(
		x: number,
		y: number,
		radiusX: number,
		radiusY: number,
		rotation: number,
		startAngle: number,
		endAngle: number
	): void;
	stroke(): void;
	fill(): void;
	globalAlpha: number;
	lineWidth: number;
	lineCap: CanvasLineCap;
	lineJoin: CanvasLineJoin;
	strokeStyle: string | CanvasGradient | CanvasPattern;
	fillStyle: string | CanvasGradient | CanvasPattern;
}

const TAU = Math.PI * 2;

/** Arrowhead barbs, as a multiple of the line width. */
const ARROWHEAD_SCALE = 4;

const ARROWHEAD_ANGLE = Math.PI / 7;

// ── Coordinate conversion ───────────────────────────────────────────

export function clamp01(value: number): number {
	// NaN fails both comparisons below and would leak through as NaN.
	if (Number.isNaN(value)) return 0;
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Surface pixels to a normalised point.
 *
 * Clamped, because a drag that leaves the preview still reports coordinates and
 * an annotation outside 0..1 would be invisible in the export while looking
 * fine in the preview.
 */
export function toNormalised(
	x: number,
	y: number,
	width: number,
	height: number
): AnnotationPoint {
	return {
		x: width > 0 ? clamp01(x / width) : 0,
		y: height > 0 ? clamp01(y / height) : 0,
	};
}

export function toPixels(
	point: AnnotationPoint,
	width: number,
	height: number
): { x: number; y: number } {
	return { x: point.x * width, y: point.y * height };
}

export function toPixelPath(
	points: AnnotationPoint[],
	width: number,
	height: number
): { x: number; y: number }[] {
	return points.map((p) => toPixels(p, width, height));
}

/** Stored width is relative to a 1080p frame; see ANNOTATION_REFERENCE_HEIGHT. */
export function scaleStrokeWidth(strokeWidth: number, height: number): number {
	const scaled = (strokeWidth * height) / ANNOTATION_REFERENCE_HEIGHT;
	// A sub-pixel line disappears entirely on a small preview.
	return Math.max(1, scaled);
}

// ── Visibility ──────────────────────────────────────────────────────

/**
 * Half-open range, matching how clips are looked up during playback.
 *
 * It also makes a zero-length range invisible everywhere rather than flashing
 * on the single frame where `t` happens to equal both bounds.
 */
export function isAnnotationVisible(annotation: Annotation, time: number): boolean {
	return time >= annotation.startTime && time < annotation.endTime;
}

export function visibleAnnotations(annotations: Annotation[], time: number): Annotation[] {
	return annotations.filter((a) => isAnnotationVisible(a, time));
}

// ── Geometry ────────────────────────────────────────────────────────

export interface AnnotationBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Normalised bounding box, or null for an annotation with no points. */
export function annotationBounds(annotation: Annotation): AnnotationBounds | null {
	if (annotation.points.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of annotation.points) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	return { minX, minY, maxX, maxY };
}

function distanceToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
	let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPath(
	point: { x: number; y: number },
	path: { x: number; y: number }[]
): number {
	if (path.length === 0) return Infinity;
	if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);
	let best = Infinity;
	for (let i = 0; i < path.length - 1; i++) {
		const d = distanceToSegment(point.x, point.y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y);
		if (d < best) best = d;
	}
	return best;
}

/**
 * Ramer–Douglas–Peucker, run on committed pen strokes.
 *
 * A pointermove-per-frame drag produces hundreds of points a few pixels apart;
 * keeping them all bloats the saved project and slows every repaint for a path
 * that looks identical with a fraction of them.
 */
export function simplifyStroke(points: AnnotationPoint[], tolerance = 0.002): AnnotationPoint[] {
	if (points.length <= 2 || tolerance <= 0) return [...points];

	const keep = new Array<boolean>(points.length).fill(false);
	keep[0] = true;
	keep[points.length - 1] = true;

	// Explicit stack rather than recursion: a long stroke can be thousands of
	// points deep in the degenerate case.
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [first, last] = stack.pop()!;
		if (last <= first + 1) continue;

		let worst = -1;
		let worstIndex = first;
		for (let i = first + 1; i < last; i++) {
			const d = distanceToSegment(
				points[i].x,
				points[i].y,
				points[first].x,
				points[first].y,
				points[last].x,
				points[last].y
			);
			if (d > worst) {
				worst = d;
				worstIndex = i;
			}
		}

		if (worst > tolerance) {
			keep[worstIndex] = true;
			stack.push([first, worstIndex], [worstIndex, last]);
		}
	}

	return points.filter((_, i) => keep[i]);
}

// ── Hit testing ─────────────────────────────────────────────────────

/**
 * Whether a normalised point lands on an annotation's ink.
 *
 * Done in surface pixels rather than normalised units: normalised distance is
 * anisotropic on a non-square frame, so a fixed normalised tolerance would make
 * horizontal strokes far easier to hit than vertical ones.
 */
export function hitTestAnnotation(
	annotation: Annotation,
	point: AnnotationPoint,
	width: number,
	height: number,
	tolerancePx = 6
): boolean {
	if (annotation.points.length === 0) return false;

	const target = toPixels(point, width, height);
	const path = toPixelPath(annotation.points, width, height);
	const lineWidth =
		scaleStrokeWidth(annotation.strokeWidth, height) *
		(annotation.type === 'highlighter' ? HIGHLIGHTER_WIDTH_SCALE : 1);
	const slack = tolerancePx + lineWidth / 2;

	if (annotation.type === 'pen' || annotation.type === 'highlighter' || annotation.type === 'arrow') {
		return distanceToPath(target, path) <= slack;
	}

	// A rect or ellipse dragged to a single point has no outline to test.
	if (path.length < 2) return distanceToPath(target, path) <= slack;

	const minX = Math.min(path[0].x, path[1].x);
	const maxX = Math.max(path[0].x, path[1].x);
	const minY = Math.min(path[0].y, path[1].y);
	const maxY = Math.max(path[0].y, path[1].y);

	if (annotation.type === 'rect') {
		return (
			distanceToPath(target, [
				{ x: minX, y: minY },
				{ x: maxX, y: minY },
				{ x: maxX, y: maxY },
				{ x: minX, y: maxY },
				{ x: minX, y: minY },
			]) <= slack
		);
	}

	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const rx = (maxX - minX) / 2;
	const ry = (maxY - minY) / 2;
	if (rx <= 0 || ry <= 0) {
		return distanceToPath(target, [
			{ x: minX, y: minY },
			{ x: maxX, y: maxY },
		]) <= slack;
	}

	// Radial distance in ellipse units; scaling by the smaller radius turns it
	// back into an approximate pixel distance from the outline.
	const radial = Math.hypot((target.x - cx) / rx, (target.y - cy) / ry);
	return Math.abs(radial - 1) * Math.min(rx, ry) <= slack;
}

/** Topmost annotation under a point, honouring paint order (last drawn wins). */
export function hitTestAnnotations(
	annotations: Annotation[],
	point: AnnotationPoint,
	width: number,
	height: number,
	tolerancePx = 6
): Annotation | null {
	for (let i = annotations.length - 1; i >= 0; i--) {
		if (hitTestAnnotation(annotations[i], point, width, height, tolerancePx)) {
			return annotations[i];
		}
	}
	return null;
}

// ── Drawing ─────────────────────────────────────────────────────────

function strokePath(ctx: AnnotationContext, path: { x: number; y: number }[]): void {
	ctx.beginPath();
	ctx.moveTo(path[0].x, path[0].y);
	for (let i = 1; i < path.length; i++) {
		ctx.lineTo(path[i].x, path[i].y);
	}
	ctx.stroke();
}

function fillDot(ctx: AnnotationContext, x: number, y: number, radius: number): void {
	ctx.beginPath();
	ctx.ellipse(x, y, radius, radius, 0, 0, TAU);
	ctx.fill();
}

function drawArrow(
	ctx: AnnotationContext,
	path: { x: number; y: number }[],
	lineWidth: number
): void {
	const tail = path[0];
	const head = path[path.length - 1];
	const angle = Math.atan2(head.y - tail.y, head.x - tail.x);
	const barb = lineWidth * ARROWHEAD_SCALE;

	strokePath(ctx, [tail, head]);
	ctx.beginPath();
	ctx.moveTo(head.x - barb * Math.cos(angle - ARROWHEAD_ANGLE), head.y - barb * Math.sin(angle - ARROWHEAD_ANGLE));
	ctx.lineTo(head.x, head.y);
	ctx.lineTo(head.x - barb * Math.cos(angle + ARROWHEAD_ANGLE), head.y - barb * Math.sin(angle + ARROWHEAD_ANGLE));
	ctx.stroke();
}

/**
 * Paints one annotation onto a surface of the given size.
 *
 * `width`/`height` are the surface's own pixels, so the caller has already
 * applied any device-pixel-ratio transform; the same call renders correctly at
 * preview size and at export size.
 */
export function drawAnnotation(
	ctx: AnnotationContext,
	annotation: Annotation,
	width: number,
	height: number
): void {
	const path = toPixelPath(annotation.points, width, height);
	if (path.length === 0) return;

	const highlighter = annotation.type === 'highlighter';
	const lineWidth =
		scaleStrokeWidth(annotation.strokeWidth, height) * (highlighter ? HIGHLIGHTER_WIDTH_SCALE : 1);

	ctx.save();
	ctx.globalAlpha = highlighter ? HIGHLIGHTER_ALPHA : 1;
	ctx.strokeStyle = annotation.color;
	ctx.fillStyle = annotation.color;
	ctx.lineWidth = lineWidth;
	// A marker leaves a flat-ended band; a pen nib is round.
	ctx.lineCap = highlighter ? 'butt' : 'round';
	ctx.lineJoin = 'round';

	switch (annotation.type) {
		case 'pen':
		case 'highlighter':
			if (path.length === 1) {
				fillDot(ctx, path[0].x, path[0].y, lineWidth / 2);
			} else {
				strokePath(ctx, path);
			}
			break;

		case 'arrow':
			// A single point gives no direction, so there is no arrow to draw.
			if (path.length >= 2) drawArrow(ctx, path, lineWidth);
			break;

		case 'rect': {
			if (path.length < 2) break;
			const x = Math.min(path[0].x, path[1].x);
			const y = Math.min(path[0].y, path[1].y);
			ctx.beginPath();
			ctx.rect(x, y, Math.abs(path[1].x - path[0].x), Math.abs(path[1].y - path[0].y));
			ctx.stroke();
			break;
		}

		case 'ellipse': {
			if (path.length < 2) break;
			const cx = (path[0].x + path[1].x) / 2;
			const cy = (path[0].y + path[1].y) / 2;
			ctx.beginPath();
			ctx.ellipse(
				cx,
				cy,
				Math.abs(path[1].x - path[0].x) / 2,
				Math.abs(path[1].y - path[0].y) / 2,
				0,
				0,
				TAU
			);
			ctx.stroke();
			break;
		}
	}

	ctx.restore();
}

/** Paints every annotation live at `time`, in stored order. */
export function drawAnnotations(
	ctx: AnnotationContext,
	annotations: Annotation[],
	time: number,
	width: number,
	height: number
): void {
	for (const annotation of annotations) {
		if (!isAnnotationVisible(annotation, time)) continue;
		drawAnnotation(ctx, annotation, width, height);
	}
}
