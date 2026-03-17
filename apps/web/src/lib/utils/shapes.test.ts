import { describe, it, expect } from 'vitest';
import { SHAPES, getShapesByCategory, getShapeById, getCategories } from './shapes.js';

describe('SHAPES', () => {
	it('should be a non-empty array', () => {
		expect(SHAPES.length).toBeGreaterThan(0);
	});

	it('should have unique ids', () => {
		const ids = SHAPES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('each shape should have required properties', () => {
		for (const shape of SHAPES) {
			expect(typeof shape.id).toBe('string');
			expect(shape.id.length).toBeGreaterThan(0);
			expect(typeof shape.name).toBe('string');
			expect(shape.name.length).toBeGreaterThan(0);
			expect(typeof shape.category).toBe('string');
			expect(typeof shape.path).toBe('string');
			expect(shape.path.length).toBeGreaterThan(0);
			expect(typeof shape.viewBox).toBe('string');
		}
	});

	it('should contain known shapes', () => {
		const ids = SHAPES.map((s) => s.id);
		expect(ids).toContain('rectangle');
		expect(ids).toContain('circle');
		expect(ids).toContain('star');
		expect(ids).toContain('heart');
		expect(ids).toContain('arrow-right');
	});
});

describe('getShapesByCategory', () => {
	it('should return a Map', () => {
		const map = getShapesByCategory();
		expect(map).toBeInstanceOf(Map);
	});

	it('should have entries for all categories', () => {
		const map = getShapesByCategory();
		const categories = getCategories();
		for (const cat of categories) {
			expect(map.has(cat)).toBe(true);
		}
	});

	it('should have non-empty arrays for each category', () => {
		const map = getShapesByCategory();
		for (const [, shapes] of map) {
			expect(shapes.length).toBeGreaterThan(0);
		}
	});

	it('should contain all shapes across all categories', () => {
		const map = getShapesByCategory();
		let total = 0;
		for (const [, shapes] of map) {
			total += shapes.length;
		}
		expect(total).toBe(SHAPES.length);
	});

	it('shapes in each category should match their category field', () => {
		const map = getShapesByCategory();
		for (const [cat, shapes] of map) {
			for (const shape of shapes) {
				expect(shape.category).toBe(cat);
			}
		}
	});
});

describe('getShapeById', () => {
	it('should return a shape for a valid id', () => {
		const shape = getShapeById('rectangle');
		expect(shape).toBeDefined();
		expect(shape!.id).toBe('rectangle');
		expect(shape!.name).toBe('Rectangle');
	});

	it('should return undefined for an unknown id', () => {
		expect(getShapeById('nonexistent')).toBeUndefined();
	});

	it('should return undefined for an empty string', () => {
		expect(getShapeById('')).toBeUndefined();
	});

	it('should return the correct shape for each known shape', () => {
		for (const shape of SHAPES) {
			const found = getShapeById(shape.id);
			expect(found).toBe(shape);
		}
	});
});

describe('getCategories', () => {
	it('should return an array of strings', () => {
		const categories = getCategories();
		expect(Array.isArray(categories)).toBe(true);
		for (const cat of categories) {
			expect(typeof cat).toBe('string');
		}
	});

	it('should contain expected categories', () => {
		const categories = getCategories();
		expect(categories).toContain('Basic');
		expect(categories).toContain('Arrows');
		expect(categories).toContain('Callouts');
		expect(categories).toContain('Social');
		expect(categories).toContain('Hand-drawn');
		expect(categories).toContain('Decorative');
	});

	it('should return a new array each time (not the original)', () => {
		const a = getCategories();
		const b = getCategories();
		expect(a).toEqual(b);
		expect(a).not.toBe(b);
	});

	it('should have 6 categories', () => {
		expect(getCategories().length).toBe(6);
	});
});
