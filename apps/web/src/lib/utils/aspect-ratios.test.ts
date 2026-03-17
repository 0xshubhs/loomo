import { describe, it, expect } from 'vitest';
import { ASPECT_RATIOS, DEFAULT_ASPECT_RATIO, scaleToResolution } from './aspect-ratios.js';

describe('ASPECT_RATIOS', () => {
	it('should be a non-empty array', () => {
		expect(ASPECT_RATIOS.length).toBeGreaterThan(0);
	});

	it('each entry should have label, width, height, and description', () => {
		for (const ratio of ASPECT_RATIOS) {
			expect(typeof ratio.label).toBe('string');
			expect(typeof ratio.width).toBe('number');
			expect(typeof ratio.height).toBe('number');
			expect(typeof ratio.description).toBe('string');
			expect(ratio.width).toBeGreaterThan(0);
			expect(ratio.height).toBeGreaterThan(0);
		}
	});

	it('should have unique labels', () => {
		const labels = ASPECT_RATIOS.map((r) => r.label);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('should contain common aspect ratios', () => {
		const labels = ASPECT_RATIOS.map((r) => r.label);
		expect(labels).toContain('16:9');
		expect(labels).toContain('9:16');
		expect(labels).toContain('1:1');
	});
});

describe('DEFAULT_ASPECT_RATIO', () => {
	it('should be 16:9', () => {
		expect(DEFAULT_ASPECT_RATIO.label).toBe('16:9');
	});

	it('should be the first entry in ASPECT_RATIOS', () => {
		expect(DEFAULT_ASPECT_RATIO).toBe(ASPECT_RATIOS[0]);
	});

	it('should have 1920x1080 dimensions', () => {
		expect(DEFAULT_ASPECT_RATIO.width).toBe(1920);
		expect(DEFAULT_ASPECT_RATIO.height).toBe(1080);
	});
});

describe('scaleToResolution', () => {
	it('should return 1920x1080 for 16:9 at 1080p', () => {
		const result = scaleToResolution('16:9', '1080p');
		expect(result).toEqual({ width: 1920, height: 1080 });
	});

	it('should return 3840x2160 for 16:9 at 4k', () => {
		const result = scaleToResolution('16:9', '4k');
		expect(result).toEqual({ width: 3840, height: 2160 });
	});

	it('should return 1280x720 for 16:9 at 720p', () => {
		const result = scaleToResolution('16:9', '720p');
		expect(result).toEqual({ width: 1280, height: 720 });
	});

	it('should return even width for 16:9 at 480p', () => {
		const result = scaleToResolution('16:9', '480p');
		expect(result.height).toBe(480);
		expect(result.width % 2).toBe(0);
	});

	it('should handle 9:16 aspect ratio', () => {
		const result = scaleToResolution('9:16', '1080p');
		expect(result.height).toBe(1080);
		// 9:16 ratio = 0.5625, width = 1080 * 0.5625 = 607.5 -> rounded to even = 608
		expect(result.width % 2).toBe(0);
		expect(result.width).toBe(608);
	});

	it('should handle 1:1 aspect ratio', () => {
		const result = scaleToResolution('1:1', '1080p');
		expect(result.height).toBe(1080);
		expect(result.width).toBe(1080);
	});

	it('should return even width for all ratios and tiers', () => {
		const tiers: ('4k' | '1080p' | '720p' | '480p')[] = ['4k', '1080p', '720p', '480p'];
		for (const ratio of ASPECT_RATIOS) {
			for (const tier of tiers) {
				const result = scaleToResolution(ratio.label, tier);
				expect(result.width % 2).toBe(0);
			}
		}
	});

	it('should fallback to 16:9 for unknown aspect label', () => {
		const result = scaleToResolution('unknown', '1080p');
		const expected = scaleToResolution('16:9', '1080p');
		expect(result).toEqual(expected);
	});

	it('should handle 21:9 ultrawide', () => {
		const result = scaleToResolution('21:9', '1080p');
		expect(result.height).toBe(1080);
		expect(result.width % 2).toBe(0);
		// 2560/1080 * 1080 = 2560
		expect(result.width).toBe(2560);
	});

	it('should handle 4:5 aspect ratio', () => {
		const result = scaleToResolution('4:5', '1080p');
		expect(result.height).toBe(1080);
		expect(result.width % 2).toBe(0);
	});
});
