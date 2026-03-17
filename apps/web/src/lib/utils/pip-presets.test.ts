import { describe, it, expect } from 'vitest';
import { PIP_PRESETS, presetToPosition, hasNonDefaultPosition } from './pip-presets.js';
import type { ClipPosition } from '$lib/types/timeline.js';

describe('PIP_PRESETS', () => {
	it('should be a non-empty array', () => {
		expect(PIP_PRESETS.length).toBeGreaterThan(0);
	});

	it('should have unique ids', () => {
		const ids = PIP_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('each preset should have id, label, x, y, width, height', () => {
		for (const preset of PIP_PRESETS) {
			expect(typeof preset.id).toBe('string');
			expect(typeof preset.label).toBe('string');
			expect(typeof preset.x).toBe('number');
			expect(typeof preset.y).toBe('number');
			expect(typeof preset.width).toBe('number');
			expect(typeof preset.height).toBe('number');
		}
	});

	it('should include a fullscreen preset', () => {
		const fs = PIP_PRESETS.find((p) => p.id === 'fullscreen');
		expect(fs).toBeDefined();
		expect(fs!.x).toBe(0);
		expect(fs!.y).toBe(0);
		expect(fs!.width).toBe(100);
		expect(fs!.height).toBe(100);
	});

	it('should include corner presets', () => {
		const ids = PIP_PRESETS.map((p) => p.id);
		expect(ids).toContain('top-left');
		expect(ids).toContain('top-right');
		expect(ids).toContain('bottom-left');
		expect(ids).toContain('bottom-right');
	});

	it('all values should be within 0-100 range', () => {
		for (const preset of PIP_PRESETS) {
			expect(preset.x).toBeGreaterThanOrEqual(0);
			expect(preset.x).toBeLessThanOrEqual(100);
			expect(preset.y).toBeGreaterThanOrEqual(0);
			expect(preset.y).toBeLessThanOrEqual(100);
			expect(preset.width).toBeGreaterThan(0);
			expect(preset.width).toBeLessThanOrEqual(100);
			expect(preset.height).toBeGreaterThan(0);
			expect(preset.height).toBeLessThanOrEqual(100);
		}
	});
});

describe('presetToPosition', () => {
	it('should convert a preset to ClipPosition with default zIndex 0', () => {
		const preset = PIP_PRESETS.find((p) => p.id === 'top-left')!;
		const pos = presetToPosition(preset);
		expect(pos).toEqual({
			x: 5,
			y: 5,
			width: 30,
			height: 30,
			zIndex: 0,
		});
	});

	it('should use provided zIndex', () => {
		const preset = PIP_PRESETS.find((p) => p.id === 'fullscreen')!;
		const pos = presetToPosition(preset, 5);
		expect(pos.zIndex).toBe(5);
	});

	it('should convert fullscreen preset correctly', () => {
		const preset = PIP_PRESETS.find((p) => p.id === 'fullscreen')!;
		const pos = presetToPosition(preset);
		expect(pos.x).toBe(0);
		expect(pos.y).toBe(0);
		expect(pos.width).toBe(100);
		expect(pos.height).toBe(100);
		expect(pos.zIndex).toBe(0);
	});

	it('should return a plain object with all ClipPosition fields', () => {
		const preset = PIP_PRESETS[0];
		const pos = presetToPosition(preset);
		expect(pos).toHaveProperty('x');
		expect(pos).toHaveProperty('y');
		expect(pos).toHaveProperty('width');
		expect(pos).toHaveProperty('height');
		expect(pos).toHaveProperty('zIndex');
	});
});

describe('hasNonDefaultPosition', () => {
	it('should return false for default position (0,0,100,100,0)', () => {
		const pos: ClipPosition = { x: 0, y: 0, width: 100, height: 100, zIndex: 0 };
		expect(hasNonDefaultPosition(pos)).toBe(false);
	});

	it('should return true when x is non-zero', () => {
		const pos: ClipPosition = { x: 10, y: 0, width: 100, height: 100, zIndex: 0 };
		expect(hasNonDefaultPosition(pos)).toBe(true);
	});

	it('should return true when y is non-zero', () => {
		const pos: ClipPosition = { x: 0, y: 5, width: 100, height: 100, zIndex: 0 };
		expect(hasNonDefaultPosition(pos)).toBe(true);
	});

	it('should return true when width is not 100', () => {
		const pos: ClipPosition = { x: 0, y: 0, width: 50, height: 100, zIndex: 0 };
		expect(hasNonDefaultPosition(pos)).toBe(true);
	});

	it('should return true when height is not 100', () => {
		const pos: ClipPosition = { x: 0, y: 0, width: 100, height: 50, zIndex: 0 };
		expect(hasNonDefaultPosition(pos)).toBe(true);
	});

	it('should return true when zIndex is non-zero', () => {
		const pos: ClipPosition = { x: 0, y: 0, width: 100, height: 100, zIndex: 1 };
		expect(hasNonDefaultPosition(pos)).toBe(true);
	});

	it('should return true when multiple fields differ', () => {
		const pos: ClipPosition = { x: 5, y: 5, width: 30, height: 30, zIndex: 2 };
		expect(hasNonDefaultPosition(pos)).toBe(true);
	});
});
