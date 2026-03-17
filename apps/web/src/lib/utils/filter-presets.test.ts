import { describe, it, expect } from 'vitest';
import {
	FILTER_PRESETS,
	applyPreset,
	hasNonDefaultFilters,
	buildCssFilterString,
	type FilterPreset,
} from './filter-presets.js';
import { DEFAULT_CLIP_FILTERS, type ClipFilters } from '$lib/types/timeline.js';

describe('FILTER_PRESETS', () => {
	it('should be a non-empty array', () => {
		expect(FILTER_PRESETS.length).toBeGreaterThan(0);
	});

	it('should have unique names', () => {
		const names = FILTER_PRESETS.map((p) => p.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('should include a "none" preset with empty overrides', () => {
		const none = FILTER_PRESETS.find((p) => p.name === 'none');
		expect(none).toBeDefined();
		expect(none!.overrides).toEqual({});
	});

	it('each preset should have name, label, color, and overrides', () => {
		for (const preset of FILTER_PRESETS) {
			expect(typeof preset.name).toBe('string');
			expect(typeof preset.label).toBe('string');
			expect(preset.color).toMatch(/^#[0-9a-fA-F]{6}$/);
			expect(typeof preset.overrides).toBe('object');
		}
	});
});

describe('applyPreset', () => {
	it('should return default filters for "none" preset', () => {
		const result = applyPreset('none');
		expect(result).toEqual(DEFAULT_CLIP_FILTERS);
	});

	it('should return default filters for unknown preset name', () => {
		const result = applyPreset('nonexistent');
		expect(result).toEqual(DEFAULT_CLIP_FILTERS);
	});

	it('should return default filters for empty string', () => {
		const result = applyPreset('');
		expect(result).toEqual(DEFAULT_CLIP_FILTERS);
	});

	it('should apply warm preset overrides on top of defaults', () => {
		const result = applyPreset('warm');
		expect(result.brightness).toBe(105);
		expect(result.saturation).toBe(120);
		expect(result.hue).toBe(15);
		// Non-overridden values should remain default
		expect(result.contrast).toBe(DEFAULT_CLIP_FILTERS.contrast);
		expect(result.blur).toBe(DEFAULT_CLIP_FILTERS.blur);
		expect(result.opacity).toBe(DEFAULT_CLIP_FILTERS.opacity);
	});

	it('should apply blackAndWhite preset (saturation: 0)', () => {
		const result = applyPreset('blackAndWhite');
		expect(result.saturation).toBe(0);
		expect(result.brightness).toBe(DEFAULT_CLIP_FILTERS.brightness);
	});

	it('should apply dramatic preset overrides', () => {
		const result = applyPreset('dramatic');
		expect(result.brightness).toBe(90);
		expect(result.contrast).toBe(140);
		expect(result.saturation).toBe(80);
	});

	it('should return a new object each time (no mutation)', () => {
		const a = applyPreset('warm');
		const b = applyPreset('warm');
		expect(a).toEqual(b);
		expect(a).not.toBe(b);
	});

	it('should apply presets with temperature and exposure', () => {
		const result = applyPreset('golden');
		expect(result.temperature).toBe(25);
		expect(result.exposure).toBe(10);
		expect(result.saturation).toBe(110);
	});
});

describe('hasNonDefaultFilters', () => {
	it('should return false for default filters', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS })).toBe(false);
	});

	it('should return true when brightness differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, brightness: 110 })).toBe(true);
	});

	it('should return true when contrast differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, contrast: 120 })).toBe(true);
	});

	it('should return true when saturation differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, saturation: 0 })).toBe(true);
	});

	it('should return true when hue differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, hue: 45 })).toBe(true);
	});

	it('should return true when blur differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, blur: 5 })).toBe(true);
	});

	it('should return true when opacity differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, opacity: 50 })).toBe(true);
	});

	it('should return true when exposure differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, exposure: 10 })).toBe(true);
	});

	it('should return true when temperature differs', () => {
		expect(hasNonDefaultFilters({ ...DEFAULT_CLIP_FILTERS, temperature: -30 })).toBe(true);
	});
});

describe('buildCssFilterString', () => {
	it('should return "none" for default filters', () => {
		expect(buildCssFilterString(DEFAULT_CLIP_FILTERS)).toBe('none');
	});

	it('should include brightness when not 100', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, brightness: 120 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('brightness(1.200)');
	});

	it('should include contrast when not 100', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, contrast: 150 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('contrast(1.5)');
	});

	it('should include saturate when saturation is not 100', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, saturation: 50 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('saturate(0.5)');
	});

	it('should include hue-rotate when hue is not 0', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, hue: 90 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('hue-rotate(90deg)');
	});

	it('should include blur when not 0', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, blur: 5 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('blur(5px)');
	});

	it('should include opacity when not 100', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, opacity: 75 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('opacity(0.75)');
	});

	it('should handle positive temperature (warm) with sepia and hue-rotate', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, temperature: 40 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('sepia(');
		expect(result).toContain('hue-rotate(-');
	});

	it('should handle negative temperature (cool) with hue-rotate', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, temperature: -50 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('hue-rotate(90deg)');
	});

	it('should add exposure offset to brightness', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, exposure: 100 };
		const result = buildCssFilterString(filters);
		// brightness = 100/100 + 100/200 = 1 + 0.5 = 1.5
		expect(result).toContain('brightness(1.500)');
	});

	it('should handle all filters combined', () => {
		const filters: ClipFilters = {
			brightness: 110,
			contrast: 120,
			saturation: 80,
			hue: 45,
			blur: 2,
			opacity: 90,
			exposure: 20,
			temperature: 30,
		};
		const result = buildCssFilterString(filters);
		expect(result).toContain('brightness(');
		expect(result).toContain('contrast(');
		expect(result).toContain('saturate(');
		expect(result).toContain('hue-rotate(45deg)');
		expect(result).toContain('blur(2px)');
		expect(result).toContain('opacity(0.9)');
		expect(result).toContain('sepia(');
	});

	it('should clamp sepia to max 1 for high temperature', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, temperature: 100 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('sepia(1.000)');
	});

	it('should return brightness(0.000) when brightness is 0 and exposure is 0', () => {
		const filters: ClipFilters = { ...DEFAULT_CLIP_FILTERS, brightness: 0 };
		const result = buildCssFilterString(filters);
		expect(result).toContain('brightness(0.000)');
	});
});
