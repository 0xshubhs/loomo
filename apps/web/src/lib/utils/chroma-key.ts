import type { ChromaKey } from '$lib/types/timeline.js';

/**
 * Color presets for chroma key in RGB (0-255).
 */
const COLOR_PRESETS: Record<string, [number, number, number]> = {
	green: [0, 177, 64],
	blue: [0, 0, 255],
	red: [255, 0, 0],
};

/**
 * Parse a chroma key color setting into an RGB tuple.
 * Supports preset names ('green', 'blue', 'red') and hex strings ('#RRGGBB').
 */
function parseChromaColor(color: string): [number, number, number] {
	if (color in COLOR_PRESETS) {
		return COLOR_PRESETS[color];
	}
	// Parse hex color
	const hex = color.replace('#', '');
	return [
		parseInt(hex.substring(0, 2), 16),
		parseInt(hex.substring(2, 4), 16),
		parseInt(hex.substring(4, 6), 16),
	];
}

/**
 * Apply chroma key effect to ImageData in-place.
 * Pixels close to the target color become transparent.
 * Smoothing creates partial alpha for edge blending.
 */
export function applyChromaKey(imageData: ImageData, settings: ChromaKey): void {
	if (!settings.enabled) return;

	const [tr, tg, tb] = parseChromaColor(settings.color);
	const threshold = settings.threshold;
	const smoothing = settings.smoothing;
	const data = imageData.data;

	// Pre-compute max distance for normalization (sqrt(3) * 255)
	const maxDist = 441.6729559300637;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];

		// Calculate normalized Euclidean distance in RGB space
		const dr = r - tr;
		const dg = g - tg;
		const db = b - tb;
		const dist = Math.sqrt(dr * dr + dg * dg + db * db) / maxDist;

		if (dist < threshold) {
			// Fully transparent — within threshold
			data[i + 3] = 0;
		} else if (dist < threshold + smoothing) {
			// Partial alpha for edge blending
			const alpha = (dist - threshold) / smoothing;
			data[i + 3] = Math.round(alpha * data[i + 3]);
		}
		// else: pixel is far from key color, leave alpha unchanged
	}
}

/**
 * Convert a chroma key color setting to FFmpeg hex format (0xRRGGBB).
 */
export function chromaColorToFFmpegHex(color: string): string {
	if (color === 'green') return '0x00B140';
	if (color === 'blue') return '0x0000FF';
	if (color === 'red') return '0xFF0000';
	// Custom hex color: #RRGGBB -> 0xRRGGBB
	return '0x' + color.replace('#', '').toUpperCase();
}
