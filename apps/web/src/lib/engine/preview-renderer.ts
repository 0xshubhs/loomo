import type { TextOverlay, TextAnimation, CaptionTrack, ShapeOverlay } from '$lib/types/index.js';
import { getShapeById } from '$lib/utils/shapes.js';

/** Duration of text animations in seconds */
const ANIMATION_DURATION = 0.5;

/**
 * Calculate animation properties (opacity, x/y offset, scale, visible characters)
 * based on animation type and the elapsed time within the overlay.
 */
function getAnimationState(
	animation: TextAnimation | undefined,
	elapsedTime: number,
	fontSize: number
): { opacity: number; offsetX: number; offsetY: number; scale: number; visibleChars: number | null } {
	const result = { opacity: 1, offsetX: 0, offsetY: 0, scale: 1, visibleChars: null as number | null };

	if (!animation || animation === 'none') return result;

	const t = Math.min(elapsedTime / ANIMATION_DURATION, 1);

	switch (animation) {
		case 'fadeIn':
			result.opacity = t;
			break;
		case 'slideUp':
			result.offsetY = (1 - t) * fontSize * 1.5;
			result.opacity = t;
			break;
		case 'slideDown':
			result.offsetY = -(1 - t) * fontSize * 1.5;
			result.opacity = t;
			break;
		case 'slideLeft':
			result.offsetX = (1 - t) * fontSize * 3;
			result.opacity = t;
			break;
		case 'slideRight':
			result.offsetX = -(1 - t) * fontSize * 3;
			result.opacity = t;
			break;
		case 'scaleIn':
			result.scale = 0.3 + t * 0.7;
			result.opacity = t;
			break;
		case 'typewriter':
			// visibleChars is handled by the caller — use a longer duration
			result.visibleChars = 0; // placeholder, calculated per-text
			break;
	}

	return result;
}

export function renderTextOverlays(
	ctx: CanvasRenderingContext2D,
	overlays: TextOverlay[],
	currentTime: number,
	canvasWidth: number,
	canvasHeight: number
): void {
	for (const overlay of overlays) {
		if (
			currentTime < overlay.timelineStart ||
			currentTime > overlay.timelineStart + overlay.duration
		) {
			continue;
		}

		ctx.save();

		const elapsedTime = currentTime - overlay.timelineStart;

		// Calculate animation state
		const anim = getAnimationState(overlay.animation, elapsedTime, overlay.fontSize);

		// Final opacity = overlay opacity * animation opacity
		ctx.globalAlpha = overlay.opacity * anim.opacity;

		let x = overlay.x * canvasWidth + anim.offsetX;
		let y = overlay.y * canvasHeight + anim.offsetY;

		// Apply scale animation via transform
		if (anim.scale !== 1) {
			ctx.translate(x, y);
			ctx.scale(anim.scale, anim.scale);
			ctx.translate(-x, -y);
		}

		// Determine the text to render (typewriter truncation)
		let displayText = overlay.text;
		if (overlay.animation === 'typewriter') {
			const charsPerSecond = 20;
			const visibleChars = Math.floor(elapsedTime * charsPerSecond);
			displayText = overlay.text.slice(0, visibleChars);
		}

		// Set font
		ctx.font = `${overlay.fontWeight} ${overlay.fontSize}px ${overlay.fontFamily}`;
		ctx.textAlign = overlay.alignment as CanvasTextAlign;
		ctx.textBaseline = 'middle';

		// Letter spacing (Canvas 2D letterSpacing support)
		if (overlay.letterSpacing && overlay.letterSpacing !== 0) {
			(ctx as any).letterSpacing = `${overlay.letterSpacing}px`;
		} else {
			(ctx as any).letterSpacing = '0px';
		}

		// Background
		if (overlay.backgroundColor && overlay.backgroundColor !== 'transparent') {
			ctx.fillStyle = overlay.backgroundColor;
			const metrics = ctx.measureText(displayText);
			const paddingX = 12;
			const paddingY = 8;
			const bgWidth = metrics.width + paddingX * 2;
			const bgHeight = overlay.fontSize + paddingY * 2;
			let bgX: number;
			switch (overlay.alignment) {
				case 'left':
					bgX = x - paddingX;
					break;
				case 'right':
					bgX = x - metrics.width - paddingX;
					break;
				default:
					bgX = x - metrics.width / 2 - paddingX;
			}
			const bgY = y - overlay.fontSize / 2 - paddingY;
			ctx.beginPath();
			ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4);
			ctx.fill();
		}

		// Apply shadow
		if (overlay.shadow?.enabled) {
			ctx.shadowColor = overlay.shadow.color;
			ctx.shadowOffsetX = overlay.shadow.offsetX;
			ctx.shadowOffsetY = overlay.shadow.offsetY;
			ctx.shadowBlur = overlay.shadow.blur;
		}

		// Apply outline (stroke text before fill so outline is behind)
		if (overlay.outline?.enabled) {
			ctx.strokeStyle = overlay.outline.color;
			ctx.lineWidth = overlay.outline.width * 2; // multiply by 2 because half is covered by fill
			ctx.lineJoin = 'round';
			ctx.strokeText(displayText, x, y);
		}

		// Clear shadow before fill if outline was drawn with shadow
		// (avoid double shadow from both strokeText and fillText)
		if (overlay.shadow?.enabled && overlay.outline?.enabled) {
			ctx.shadowColor = 'transparent';
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
			ctx.shadowBlur = 0;
		}

		// Fill text
		ctx.fillStyle = overlay.color;
		ctx.fillText(displayText, x, y);

		ctx.restore();
	}
}

/**
 * Render active captions on the canvas at the given currentTime.
 */
export function renderCaptions(
	ctx: CanvasRenderingContext2D,
	captionTrack: CaptionTrack,
	currentTime: number,
	canvasWidth: number,
	canvasHeight: number
): void {
	if (!captionTrack.enabled || captionTrack.segments.length === 0) return;

	// Find active segment
	const segment = captionTrack.segments.find(
		(s) => currentTime >= s.startTime && currentTime <= s.endTime
	);
	if (!segment) return;

	const style = captionTrack.style;

	ctx.save();

	// Font
	ctx.font = `bold ${style.fontSize}px ${style.fontFamily}`;
	ctx.textAlign = style.alignment as CanvasTextAlign;
	ctx.textBaseline = 'middle';

	// Position
	let x: number;
	switch (style.alignment) {
		case 'left':
			x = canvasWidth * 0.05;
			break;
		case 'right':
			x = canvasWidth * 0.95;
			break;
		default:
			x = canvasWidth / 2;
	}

	let y: number;
	switch (style.position) {
		case 'top':
			y = canvasHeight * 0.1;
			break;
		case 'center':
			y = canvasHeight * 0.5;
			break;
		default:
			y = canvasHeight * 0.85;
	}

	const text = segment.text;
	const metrics = ctx.measureText(text);
	const padding = 8;

	// Background
	if (style.backgroundColor && style.backgroundColor !== 'transparent') {
		ctx.fillStyle = style.backgroundColor;

		let bgX: number;
		switch (style.alignment) {
			case 'left':
				bgX = x - padding;
				break;
			case 'right':
				bgX = x - metrics.width - padding;
				break;
			default:
				bgX = x - metrics.width / 2 - padding;
		}

		ctx.beginPath();
		const bgWidth = metrics.width + padding * 2;
		const bgHeight = style.fontSize + padding * 2;
		const radius = 4;
		const bgY = y - style.fontSize / 2 - padding;
		ctx.roundRect(bgX, bgY, bgWidth, bgHeight, radius);
		ctx.fill();
	}

	// Text
	ctx.fillStyle = style.fontColor;
	ctx.fillText(text, x, y);

	ctx.restore();
}

// ── Shape path cache ────────────────────────────────────────────────
const pathCache = new Map<string, Path2D>();

function getPath2D(svgPath: string): Path2D {
	let cached = pathCache.get(svgPath);
	if (!cached) {
		cached = new Path2D(svgPath);
		pathCache.set(svgPath, cached);
	}
	return cached;
}

/**
 * Render shape overlays on the canvas.
 * Shapes use percentage-based positioning (0-100) mapped to canvas dimensions.
 */
export function renderShapeOverlays(
	ctx: CanvasRenderingContext2D,
	overlays: ShapeOverlay[],
	currentTime: number,
	canvasWidth: number,
	canvasHeight: number
): void {
	for (const overlay of overlays) {
		if (
			currentTime < overlay.startTime ||
			currentTime > overlay.startTime + overlay.duration
		) {
			continue;
		}

		const shapeDef = getShapeById(overlay.shapeId);
		if (!shapeDef) continue;

		ctx.save();

		ctx.globalAlpha = overlay.opacity;

		// Position: percentage of canvas
		const x = (overlay.x / 100) * canvasWidth;
		const y = (overlay.y / 100) * canvasHeight;

		// Move to position, apply rotation, then draw centered shape
		ctx.translate(x, y);

		if (overlay.rotation !== 0) {
			ctx.rotate((overlay.rotation * Math.PI) / 180);
		}

		// Parse viewBox to get the original shape coordinate space
		const vb = shapeDef.viewBox.split(' ').map(Number);
		const vbW = vb[2] || 100;
		const vbH = vb[3] || 100;

		// Scale shape from viewBox space to overlay pixel size, centered
		const scaleX = overlay.width / vbW;
		const scaleY = overlay.height / vbH;
		ctx.translate(-overlay.width / 2, -overlay.height / 2);
		ctx.scale(scaleX, scaleY);

		const path = getPath2D(shapeDef.path);

		// Fill
		if (overlay.fillColor && overlay.fillColor !== 'transparent') {
			ctx.fillStyle = overlay.fillColor;
			ctx.fill(path);
		}

		// Stroke
		if (overlay.strokeWidth > 0 && overlay.strokeColor) {
			ctx.strokeStyle = overlay.strokeColor;
			ctx.lineWidth = overlay.strokeWidth / Math.min(scaleX, scaleY);
			ctx.stroke(path);
		}

		ctx.restore();
	}
}
