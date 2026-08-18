import { describe, it, expect } from 'vitest';
import {
	annotationBounds,
	clamp01,
	drawAnnotation,
	drawAnnotations,
	hitTestAnnotation,
	hitTestAnnotations,
	isAnnotationVisible,
	scaleStrokeWidth,
	simplifyStroke,
	toNormalised,
	toPixelPath,
	toPixels,
	visibleAnnotations,
	type AnnotationContext,
} from './annotation-render.js';
import { createAnnotation, HIGHLIGHTER_ALPHA, HIGHLIGHTER_WIDTH_SCALE } from '$lib/types/annotations.js';
import type { Annotation, AnnotationPoint, AnnotationType } from '$lib/types/annotations.js';

interface PathOp {
	op: string;
	args: number[];
}

interface Paint {
	op: 'stroke' | 'fill';
	lineWidth: number;
	alpha: number;
	color: string;
	lineCap: CanvasLineCap;
	path: PathOp[];
}

/**
 * Stand-in for a 2D context.
 *
 * Style properties are mutable, so each stroke/fill snapshots the state that
 * was in force when it happened — otherwise a later `restore()` would erase the
 * very thing under test.
 */
class RecordingContext implements AnnotationContext {
	globalAlpha = 1;
	lineWidth = 1;
	lineCap: CanvasLineCap = 'butt';
	lineJoin: CanvasLineJoin = 'miter';
	strokeStyle: string | CanvasGradient | CanvasPattern = '';
	fillStyle: string | CanvasGradient | CanvasPattern = '';

	painted: Paint[] = [];
	private path: PathOp[] = [];

	save(): void {}
	restore(): void {}
	closePath(): void {}

	beginPath(): void {
		this.path = [];
	}
	moveTo(x: number, y: number): void {
		this.path.push({ op: 'moveTo', args: [x, y] });
	}
	lineTo(x: number, y: number): void {
		this.path.push({ op: 'lineTo', args: [x, y] });
	}
	rect(x: number, y: number, w: number, h: number): void {
		this.path.push({ op: 'rect', args: [x, y, w, h] });
	}
	ellipse(x: number, y: number, rx: number, ry: number): void {
		this.path.push({ op: 'ellipse', args: [x, y, rx, ry] });
	}
	stroke(): void {
		this.record('stroke', String(this.strokeStyle));
	}
	fill(): void {
		this.record('fill', String(this.fillStyle));
	}

	private record(op: 'stroke' | 'fill', color: string): void {
		this.painted.push({
			op,
			color,
			lineWidth: this.lineWidth,
			alpha: this.globalAlpha,
			lineCap: this.lineCap,
			path: [...this.path],
		});
	}
}

function make(
	type: AnnotationType,
	points: AnnotationPoint[],
	overrides: Partial<Annotation> = {}
): Annotation {
	return createAnnotation({ id: 'a1', type, points, strokeWidth: 6, ...overrides });
}

describe('clamp01', () => {
	it('passes through the unit range', () => {
		expect(clamp01(0)).toBe(0);
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(1)).toBe(1);
	});

	it('clamps outside it, including non-finite input', () => {
		expect(clamp01(-2)).toBe(0);
		expect(clamp01(7)).toBe(1);
		expect(clamp01(NaN)).toBe(0);
		expect(clamp01(Infinity)).toBe(1);
	});
});

describe('toNormalised', () => {
	it('divides by the surface size', () => {
		expect(toNormalised(320, 90, 640, 360)).toEqual({ x: 0.5, y: 0.25 });
	});

	it('clamps a drag that left the preview', () => {
		// Pointer capture keeps reporting coordinates past the edge; an
		// out-of-range point would be invisible in the export but not the preview.
		expect(toNormalised(-40, 900, 640, 360)).toEqual({ x: 0, y: 1 });
	});

	it('survives a zero-sized surface', () => {
		expect(toNormalised(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
	});
});

describe('normalised coordinates across resolutions', () => {
	it('puts a 640x360 preview stroke in the same relative place at 3840x2160', () => {
		// The whole reason coordinates are normalised: drawn small, exported big.
		const drawn = [toNormalised(160, 90, 640, 360), toNormalised(480, 270, 640, 360)];

		const preview = toPixelPath(drawn, 640, 360);
		const export4k = toPixelPath(drawn, 3840, 2160);

		expect(preview).toEqual([
			{ x: 160, y: 90 },
			{ x: 480, y: 270 },
		]);
		expect(export4k).toEqual([
			{ x: 960, y: 540 },
			{ x: 2880, y: 1620 },
		]);

		for (let i = 0; i < preview.length; i++) {
			expect(preview[i].x / 640).toBeCloseTo(export4k[i].x / 3840, 10);
			expect(preview[i].y / 360).toBeCloseTo(export4k[i].y / 2160, 10);
		}
	});

	it('renders a rectangle at the same relative position and size at both sizes', () => {
		const annotation = make('rect', [
			toNormalised(64, 36, 640, 360),
			toNormalised(320, 180, 640, 360),
		]);

		const small = new RecordingContext();
		const large = new RecordingContext();
		drawAnnotation(small, annotation, 640, 360);
		drawAnnotation(large, annotation, 3840, 2160);

		const smallRect = small.painted[0].path[0].args;
		const largeRect = large.painted[0].path[0].args;

		expect(smallRect).toEqual([64, 36, 256, 144]);
		// 6x the preview in both axes, exactly like the frame.
		expect(largeRect).toEqual([384, 216, 1536, 864]);
		expect(largeRect.map((v, i) => v / smallRect[i])).toEqual([6, 6, 6, 6]);
	});

	it('scales stroke width with the frame so lines are not hairlines in 4K', () => {
		expect(scaleStrokeWidth(6, 1080)).toBe(6);
		expect(scaleStrokeWidth(6, 2160)).toBe(12);
		expect(scaleStrokeWidth(6, 360)).toBe(2);
	});

	it('never lets a line fall below one pixel', () => {
		expect(scaleStrokeWidth(1, 200)).toBe(1);
		expect(scaleStrokeWidth(0, 1080)).toBe(1);
	});
});

describe('toPixels', () => {
	it('is the inverse of toNormalised', () => {
		const point = toNormalised(123, 45, 640, 360);
		const back = toPixels(point, 640, 360);
		expect(back.x).toBeCloseTo(123, 10);
		expect(back.y).toBeCloseTo(45, 10);
	});
});

describe('isAnnotationVisible', () => {
	const annotation = make('pen', [{ x: 0, y: 0 }], { startTime: 2, endTime: 5 });

	it('covers the range from its start up to its end', () => {
		expect(isAnnotationVisible(annotation, 2)).toBe(true);
		expect(isAnnotationVisible(annotation, 4.99)).toBe(true);
	});

	it('excludes the end instant and anything outside', () => {
		expect(isAnnotationVisible(annotation, 5)).toBe(false);
		expect(isAnnotationVisible(annotation, 1.99)).toBe(false);
	});

	it('is never visible with a zero-length range', () => {
		const instant = make('pen', [{ x: 0, y: 0 }], { startTime: 3, endTime: 3 });
		expect(isAnnotationVisible(instant, 3)).toBe(false);
		expect(isAnnotationVisible(instant, 2.999)).toBe(false);
	});

	it('is never visible with an inverted range', () => {
		const inverted = make('pen', [{ x: 0, y: 0 }], { startTime: 6, endTime: 2 });
		expect(isAnnotationVisible(inverted, 4)).toBe(false);
	});

	it('filters a list down to what is on screen', () => {
		const early = make('pen', [{ x: 0, y: 0 }], { startTime: 0, endTime: 1 });
		const late = make('pen', [{ x: 0, y: 0 }], { startTime: 4, endTime: 9 });
		expect(visibleAnnotations([early, annotation, late], 4.5).map((a) => a.startTime)).toEqual([
			2, 4,
		]);
	});
});

describe('annotationBounds', () => {
	it('is null when there is nothing to bound', () => {
		expect(annotationBounds(make('pen', []))).toBeNull();
	});

	it('collapses to a point for a single-point stroke', () => {
		expect(annotationBounds(make('pen', [{ x: 0.3, y: 0.7 }]))).toEqual({
			minX: 0.3,
			minY: 0.7,
			maxX: 0.3,
			maxY: 0.7,
		});
	});

	it('spans every point regardless of drag direction', () => {
		const bounds = annotationBounds(
			make('rect', [
				{ x: 0.8, y: 0.9 },
				{ x: 0.2, y: 0.1 },
			])
		);
		expect(bounds).toEqual({ minX: 0.2, minY: 0.1, maxX: 0.8, maxY: 0.9 });
	});
});

describe('simplifyStroke', () => {
	it('leaves degenerate strokes alone', () => {
		expect(simplifyStroke([])).toEqual([]);
		expect(simplifyStroke([{ x: 0.5, y: 0.5 }])).toEqual([{ x: 0.5, y: 0.5 }]);
	});

	it('keeps both endpoints of a two-point stroke', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		];
		expect(simplifyStroke(points)).toEqual(points);
	});

	it('collapses a straight run to its endpoints', () => {
		const straight = Array.from({ length: 50 }, (_, i) => ({ x: i / 49, y: 0.5 }));
		expect(simplifyStroke(straight)).toEqual([
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 },
		]);
	});

	it('keeps a corner that the tolerance cannot excuse', () => {
		const corner = [
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0.5 },
			{ x: 1, y: 0 },
		];
		expect(simplifyStroke(corner)).toHaveLength(3);
	});

	it('does not mutate the input', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0.001 },
			{ x: 1, y: 0 },
		];
		simplifyStroke(points);
		expect(points).toHaveLength(3);
	});
});

describe('hitTestAnnotation', () => {
	const W = 640;
	const H = 360;

	it('misses an annotation with no points', () => {
		expect(hitTestAnnotation(make('pen', []), { x: 0.5, y: 0.5 }, W, H)).toBe(false);
	});

	it('hits along a pen stroke and misses beside it', () => {
		const pen = make('pen', [
			{ x: 0.2, y: 0.5 },
			{ x: 0.8, y: 0.5 },
		]);
		expect(hitTestAnnotation(pen, { x: 0.5, y: 0.5 }, W, H)).toBe(true);
		expect(hitTestAnnotation(pen, { x: 0.5, y: 0.9 }, W, H)).toBe(false);
	});

	it('hits a single-point pen dot', () => {
		const dot = make('pen', [{ x: 0.5, y: 0.5 }]);
		expect(hitTestAnnotation(dot, { x: 0.5, y: 0.5 }, W, H)).toBe(true);
		expect(hitTestAnnotation(dot, { x: 0.7, y: 0.5 }, W, H)).toBe(false);
	});

	it('hits a rectangle on its outline, not through its middle', () => {
		const rect = make('rect', [
			{ x: 0.25, y: 0.25 },
			{ x: 0.75, y: 0.75 },
		]);
		expect(hitTestAnnotation(rect, { x: 0.5, y: 0.25 }, W, H)).toBe(true);
		expect(hitTestAnnotation(rect, { x: 0.25, y: 0.5 }, W, H)).toBe(true);
		expect(hitTestAnnotation(rect, { x: 0.5, y: 0.5 }, W, H)).toBe(false);
	});

	it('hits an ellipse on its boundary, not through its middle', () => {
		const ellipse = make('ellipse', [
			{ x: 0.25, y: 0.25 },
			{ x: 0.75, y: 0.75 },
		]);
		expect(hitTestAnnotation(ellipse, { x: 0.75, y: 0.5 }, W, H)).toBe(true);
		expect(hitTestAnnotation(ellipse, { x: 0.5, y: 0.25 }, W, H)).toBe(true);
		expect(hitTestAnnotation(ellipse, { x: 0.5, y: 0.5 }, W, H)).toBe(false);
	});

	it('treats a shape dragged to a single point as a point', () => {
		const collapsed = make('ellipse', [
			{ x: 0.4, y: 0.4 },
			{ x: 0.4, y: 0.4 },
		]);
		expect(hitTestAnnotation(collapsed, { x: 0.4, y: 0.4 }, W, H)).toBe(true);
		expect(hitTestAnnotation(collapsed, { x: 0.9, y: 0.9 }, W, H)).toBe(false);
	});

	it('hits along an arrow shaft', () => {
		const arrow = make('arrow', [
			{ x: 0.1, y: 0.1 },
			{ x: 0.9, y: 0.9 },
		]);
		expect(hitTestAnnotation(arrow, { x: 0.5, y: 0.5 }, W, H)).toBe(true);
		expect(hitTestAnnotation(arrow, { x: 0.1, y: 0.9 }, W, H)).toBe(false);
	});

	it('gives a highlighter its wider nib', () => {
		// 0.005 of a 360px surface is 1.8px: outside the pen's 1px nib, well
		// inside the marker's 8px one.
		const at = { x: 0.5, y: 0.505 };
		const stroke: AnnotationPoint[] = [
			{ x: 0.2, y: 0.5 },
			{ x: 0.8, y: 0.5 },
		];
		expect(hitTestAnnotation(make('pen', stroke), at, W, H, 0)).toBe(false);
		expect(hitTestAnnotation(make('highlighter', stroke), at, W, H, 0)).toBe(true);
	});

	it('gives the same answer at preview and export resolution', () => {
		// Both the offset and the nib scale with the frame, so a mark the user
		// grabbed in the preview is the mark they grabbed at 4K.
		const pen = make('pen', [
			{ x: 0.2, y: 0.5 },
			{ x: 0.8, y: 0.5 },
		]);
		const near = { x: 0.5, y: 0.502 };
		const far = { x: 0.5, y: 0.6 };

		expect(hitTestAnnotation(pen, near, 640, 360, 0)).toBe(true);
		expect(hitTestAnnotation(pen, near, 3840, 2160, 0)).toBe(true);
		expect(hitTestAnnotation(pen, far, 640, 360, 0)).toBe(false);
		expect(hitTestAnnotation(pen, far, 3840, 2160, 0)).toBe(false);
	});
});

describe('hitTestAnnotations', () => {
	const stroke: AnnotationPoint[] = [
		{ x: 0.2, y: 0.5 },
		{ x: 0.8, y: 0.5 },
	];
	const under = { ...make('pen', stroke), id: 'under' };
	const over = { ...make('pen', stroke), id: 'over' };

	it('returns the last drawn of two overlapping marks', () => {
		expect(hitTestAnnotations([under, over], { x: 0.5, y: 0.5 }, 640, 360)?.id).toBe('over');
	});

	it('returns null when nothing is under the point', () => {
		expect(hitTestAnnotations([under, over], { x: 0.5, y: 0.95 }, 640, 360)).toBeNull();
	});

	it('returns null for an empty list', () => {
		expect(hitTestAnnotations([], { x: 0.5, y: 0.5 }, 640, 360)).toBeNull();
	});
});

describe('drawAnnotation', () => {
	const W = 1000;
	const H = 1080;

	it('paints nothing for an empty stroke', () => {
		const ctx = new RecordingContext();
		drawAnnotation(ctx, make('pen', []), W, H);
		expect(ctx.painted).toEqual([]);
	});

	it('paints a single-point pen stroke as a filled dot', () => {
		const ctx = new RecordingContext();
		drawAnnotation(ctx, make('pen', [{ x: 0.5, y: 0.5 }]), W, H);
		expect(ctx.painted).toHaveLength(1);
		expect(ctx.painted[0].op).toBe('fill');
		expect(ctx.painted[0].path[0]).toEqual({ op: 'ellipse', args: [500, 540, 3, 3] });
	});

	it('paints a multi-point pen stroke as one polyline', () => {
		const ctx = new RecordingContext();
		drawAnnotation(
			ctx,
			make('pen', [
				{ x: 0, y: 0 },
				{ x: 0.5, y: 0.5 },
				{ x: 1, y: 0 },
			]),
			W,
			H
		);
		expect(ctx.painted).toHaveLength(1);
		expect(ctx.painted[0].op).toBe('stroke');
		expect(ctx.painted[0].path.map((p) => p.op)).toEqual(['moveTo', 'lineTo', 'lineTo']);
	});

	it('paints an arrow as a shaft plus a head', () => {
		const ctx = new RecordingContext();
		drawAnnotation(
			ctx,
			make('arrow', [
				{ x: 0.1, y: 0.5 },
				{ x: 0.9, y: 0.5 },
			]),
			W,
			H
		);
		expect(ctx.painted.map((p) => p.op)).toEqual(['stroke', 'stroke']);
		// The head's barbs converge on the tip.
		expect(ctx.painted[1].path[1].args).toEqual([900, 540]);
	});

	it('paints nothing for a one-point arrow, which has no direction', () => {
		const ctx = new RecordingContext();
		drawAnnotation(ctx, make('arrow', [{ x: 0.5, y: 0.5 }]), W, H);
		expect(ctx.painted).toEqual([]);
	});

	it('normalises a rectangle dragged from bottom-right to top-left', () => {
		const ctx = new RecordingContext();
		drawAnnotation(
			ctx,
			make('rect', [
				{ x: 0.8, y: 0.8 },
				{ x: 0.2, y: 0.2 },
			]),
			W,
			H
		);
		expect(ctx.painted[0].path[0]).toEqual({ op: 'rect', args: [200, 216, 600, 648] });
	});

	it('centres an ellipse in its bounding box', () => {
		const ctx = new RecordingContext();
		drawAnnotation(
			ctx,
			make('ellipse', [
				{ x: 0.2, y: 0.2 },
				{ x: 0.8, y: 0.6 },
			]),
			W,
			H
		);
		expect(ctx.painted[0].path[0]).toEqual({ op: 'ellipse', args: [500, 432, 300, 216] });
	});

	it('gives the highlighter a translucent, wider, flat-capped nib', () => {
		const ctx = new RecordingContext();
		drawAnnotation(
			ctx,
			make('highlighter', [
				{ x: 0.2, y: 0.5 },
				{ x: 0.8, y: 0.5 },
			]),
			W,
			H
		);
		expect(ctx.painted[0].alpha).toBe(HIGHLIGHTER_ALPHA);
		expect(ctx.painted[0].lineWidth).toBe(6 * HIGHLIGHTER_WIDTH_SCALE);
		expect(ctx.painted[0].lineCap).toBe('butt');
	});

	it('paints a pen stroke opaque in its own colour', () => {
		const ctx = new RecordingContext();
		drawAnnotation(
			ctx,
			make('pen', [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			], { color: '#00ff00' }),
			W,
			H
		);
		expect(ctx.painted[0].alpha).toBe(1);
		expect(ctx.painted[0].color).toBe('#00ff00');
		expect(ctx.painted[0].lineCap).toBe('round');
	});
});

describe('drawAnnotations', () => {
	it('paints only what the playhead is over, in stored order', () => {
		const ctx = new RecordingContext();
		const early = make('pen', [{ x: 0, y: 0 }, { x: 1, y: 1 }], {
			startTime: 0,
			endTime: 1,
			color: '#111111',
		});
		const now = make('pen', [{ x: 0, y: 0 }, { x: 1, y: 1 }], {
			startTime: 1,
			endTime: 4,
			color: '#222222',
		});
		const later = make('pen', [{ x: 0, y: 0 }, { x: 1, y: 1 }], {
			startTime: 2,
			endTime: 9,
			color: '#333333',
		});

		drawAnnotations(ctx, [early, now, later], 2.5, 640, 360);
		expect(ctx.painted.map((p) => p.color)).toEqual(['#222222', '#333333']);
	});

	it('paints nothing when the list is empty', () => {
		const ctx = new RecordingContext();
		drawAnnotations(ctx, [], 0, 640, 360);
		expect(ctx.painted).toEqual([]);
	});
});
