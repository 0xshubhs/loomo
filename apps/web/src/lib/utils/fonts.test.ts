import { describe, it, expect } from 'vitest';
import { FONT_LIST, GOOGLE_FONTS } from './fonts.js';

describe('FONT_LIST', () => {
	it('should be a non-empty array', () => {
		expect(FONT_LIST.length).toBeGreaterThan(0);
	});

	it('each font should have name, value, and category', () => {
		for (const font of FONT_LIST) {
			expect(typeof font.name).toBe('string');
			expect(font.name.length).toBeGreaterThan(0);
			expect(typeof font.value).toBe('string');
			expect(font.value.length).toBeGreaterThan(0);
			expect(['sans-serif', 'serif', 'monospace', 'display']).toContain(font.category);
		}
	});

	it('should contain common fonts', () => {
		const names = FONT_LIST.map((f) => f.name);
		expect(names).toContain('Arial');
		expect(names).toContain('Inter');
		expect(names).toContain('Georgia');
		expect(names).toContain('Courier New');
	});

	it('should have unique values', () => {
		const values = FONT_LIST.map((f) => f.value);
		expect(new Set(values).size).toBe(values.length);
	});

	it('should have all four categories represented', () => {
		const categories = new Set(FONT_LIST.map((f) => f.category));
		expect(categories.has('sans-serif')).toBe(true);
		expect(categories.has('serif')).toBe(true);
		expect(categories.has('monospace')).toBe(true);
		expect(categories.has('display')).toBe(true);
	});
});

describe('GOOGLE_FONTS', () => {
	it('should be a non-empty array', () => {
		expect(GOOGLE_FONTS.length).toBeGreaterThan(0);
	});

	it('should not include system fonts', () => {
		const systemFonts = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];
		const googleFontValues = GOOGLE_FONTS.map((f) => f.value);
		for (const sysFont of systemFonts) {
			expect(googleFontValues).not.toContain(sysFont);
		}
	});

	it('should include Google-loadable fonts', () => {
		const googleFontValues = GOOGLE_FONTS.map((f) => f.value);
		expect(googleFontValues).toContain('Inter');
		expect(googleFontValues).toContain('Roboto');
		expect(googleFontValues).toContain('Poppins');
	});

	it('should be a subset of FONT_LIST', () => {
		for (const gf of GOOGLE_FONTS) {
			expect(FONT_LIST).toContain(gf);
		}
	});

	it('should have fewer items than FONT_LIST', () => {
		expect(GOOGLE_FONTS.length).toBeLessThan(FONT_LIST.length);
	});

	it('GOOGLE_FONTS + system fonts should equal FONT_LIST length', () => {
		const systemFonts = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];
		expect(GOOGLE_FONTS.length + systemFonts.length).toBe(FONT_LIST.length);
	});
});
