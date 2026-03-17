import { describe, it, expect } from 'vitest';
import { clamp, lerp, inverseLerp, remap, roundTo } from './math';

describe('clamp', () => {
	it('clamps below min', () => {
		expect(clamp(-5, 0, 10)).toBe(0);
	});

	it('clamps above max', () => {
		expect(clamp(15, 0, 10)).toBe(10);
	});

	it('returns value in range', () => {
		expect(clamp(5, 0, 10)).toBe(5);
	});

	it('handles min === max', () => {
		expect(clamp(5, 3, 3)).toBe(3);
	});
});

describe('lerp', () => {
	it('returns a at t=0', () => {
		expect(lerp(0, 10, 0)).toBe(0);
	});

	it('returns b at t=1', () => {
		expect(lerp(0, 10, 1)).toBe(10);
	});

	it('returns midpoint at t=0.5', () => {
		expect(lerp(0, 10, 0.5)).toBe(5);
	});

	it('extrapolates beyond 0-1', () => {
		expect(lerp(0, 10, 2)).toBe(20);
	});
});

describe('inverseLerp', () => {
	it('returns 0 at a', () => {
		expect(inverseLerp(0, 10, 0)).toBe(0);
	});

	it('returns 1 at b', () => {
		expect(inverseLerp(0, 10, 10)).toBe(1);
	});

	it('returns 0.5 at midpoint', () => {
		expect(inverseLerp(0, 10, 5)).toBe(0.5);
	});
});

describe('remap', () => {
	it('remaps from one range to another', () => {
		expect(remap(5, 0, 10, 0, 100)).toBe(50);
	});

	it('remaps across different ranges', () => {
		expect(remap(0.5, 0, 1, 100, 200)).toBe(150);
	});
});

describe('roundTo', () => {
	it('rounds to specified decimal places', () => {
		expect(roundTo(3.14159, 2)).toBe(3.14);
	});

	it('rounds to 0 decimal places', () => {
		expect(roundTo(3.7, 0)).toBe(4);
	});

	it('handles whole numbers', () => {
		expect(roundTo(5, 3)).toBe(5);
	});
});
