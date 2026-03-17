import { describe, it, expect } from 'vitest';
import { applyChromaKey, chromaColorToFFmpegHex } from './chroma-key.js';
import type { ChromaKey } from '$lib/types/timeline.js';

/**
 * Helper to create a minimal ImageData-like object for testing.
 */
function createImageData(pixels: number[][]): ImageData {
	const data = new Uint8ClampedArray(pixels.length * 4);
	for (let i = 0; i < pixels.length; i++) {
		data[i * 4] = pixels[i][0];     // R
		data[i * 4 + 1] = pixels[i][1]; // G
		data[i * 4 + 2] = pixels[i][2]; // B
		data[i * 4 + 3] = pixels[i][3]; // A
	}
	return {
		data,
		width: pixels.length,
		height: 1,
		colorSpace: 'srgb',
	} as ImageData;
}

describe('applyChromaKey', () => {
	it('should do nothing when enabled is false', () => {
		const imageData = createImageData([[0, 177, 64, 255]]);
		const settings: ChromaKey = {
			enabled: false,
			color: 'green',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(255);
	});

	it('should make green pixels fully transparent with green key', () => {
		const imageData = createImageData([[0, 177, 64, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(0);
	});

	it('should leave non-green pixels opaque with green key', () => {
		const imageData = createImageData([[255, 0, 0, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(255);
	});

	it('should make blue pixels transparent with blue key', () => {
		const imageData = createImageData([[0, 0, 255, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'blue',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(0);
	});

	it('should make red pixels transparent with red key', () => {
		const imageData = createImageData([[255, 0, 0, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'red',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(0);
	});

	it('should support custom hex colors', () => {
		const imageData = createImageData([[128, 128, 128, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: '#808080',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(0);
	});

	it('should apply partial alpha for edge pixels (smoothing zone)', () => {
		// A pixel that is near-green but not exactly green
		const imageData = createImageData([[50, 200, 80, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 0.05,
			smoothing: 0.5,
		};
		applyChromaKey(imageData, settings);
		// Should have partial alpha (not 0 and not 255)
		const alpha = imageData.data[3];
		expect(alpha).toBeGreaterThan(0);
		expect(alpha).toBeLessThan(255);
	});

	it('should process multiple pixels', () => {
		const imageData = createImageData([
			[0, 177, 64, 255],   // exact green -> transparent
			[255, 255, 255, 255], // white -> opaque
			[0, 177, 64, 255],   // exact green -> transparent
		]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(0);
		expect(imageData.data[7]).toBe(255);
		expect(imageData.data[11]).toBe(0);
	});

	it('should handle threshold of 0 (only exact match)', () => {
		const imageData = createImageData([[0, 177, 64, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 0,
			smoothing: 0,
		};
		applyChromaKey(imageData, settings);
		// Distance is 0 which is not < 0, so pixel is unchanged
		expect(imageData.data[3]).toBe(255);
	});

	it('should handle threshold of 1 (everything transparent)', () => {
		const imageData = createImageData([[255, 128, 0, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 1.0,
			smoothing: 0.0,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[3]).toBe(0);
	});

	it('should not modify RGB values, only alpha', () => {
		const imageData = createImageData([[0, 177, 64, 255]]);
		const settings: ChromaKey = {
			enabled: true,
			color: 'green',
			threshold: 0.4,
			smoothing: 0.1,
		};
		applyChromaKey(imageData, settings);
		expect(imageData.data[0]).toBe(0);
		expect(imageData.data[1]).toBe(177);
		expect(imageData.data[2]).toBe(64);
	});
});

describe('chromaColorToFFmpegHex', () => {
	it('should convert "green" to 0x00B140', () => {
		expect(chromaColorToFFmpegHex('green')).toBe('0x00B140');
	});

	it('should convert "blue" to 0x0000FF', () => {
		expect(chromaColorToFFmpegHex('blue')).toBe('0x0000FF');
	});

	it('should convert "red" to 0xFF0000', () => {
		expect(chromaColorToFFmpegHex('red')).toBe('0xFF0000');
	});

	it('should convert custom hex "#abcdef" to 0xABCDEF', () => {
		expect(chromaColorToFFmpegHex('#abcdef')).toBe('0xABCDEF');
	});

	it('should convert custom hex "#000000" to 0x000000', () => {
		expect(chromaColorToFFmpegHex('#000000')).toBe('0x000000');
	});

	it('should convert custom hex "#FFFFFF" to 0xFFFFFF', () => {
		expect(chromaColorToFFmpegHex('#FFFFFF')).toBe('0xFFFFFF');
	});

	it('should handle uppercase hex input', () => {
		expect(chromaColorToFFmpegHex('#AA00FF')).toBe('0xAA00FF');
	});
});
