import type { TextOverlay } from '$lib/types/index.js';

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
		ctx.globalAlpha = overlay.opacity;

		const x = overlay.x * canvasWidth;
		const y = overlay.y * canvasHeight;

		if (overlay.backgroundColor && overlay.backgroundColor !== 'transparent') {
			ctx.fillStyle = overlay.backgroundColor;
			const metrics = ctx.measureText(overlay.text);
			const padding = 10;
			ctx.fillRect(
				x - metrics.width / 2 - padding,
				y - overlay.fontSize / 2 - padding,
				metrics.width + padding * 2,
				overlay.fontSize + padding * 2
			);
		}

		ctx.fillStyle = overlay.color;
		ctx.font = `${overlay.fontWeight} ${overlay.fontSize}px ${overlay.fontFamily}`;
		ctx.textAlign = overlay.alignment as CanvasTextAlign;
		ctx.textBaseline = 'middle';
		ctx.fillText(overlay.text, x, y);

		ctx.restore();
	}
}
