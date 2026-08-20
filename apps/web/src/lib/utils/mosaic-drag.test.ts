import { describe, it, expect } from 'vitest';
import {
	clampRegion,
	moveRegion,
	resizeRegion,
	handleAt,
	regionAt,
	cursorFor,
	MIN_REGION_PERCENT,
} from './mosaic-drag.js';
import type { MosaicRegion } from '$lib/types/timeline.js';

/**
 * Mosaic regions were four sliders. Covering a face by typing percentages is
 * the kind of task a mouse exists for, and the numbers a drag produces have to
 * be the same numbers the sliders produce, because the export reads them.
 */

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function region(over: Partial<MosaicRegion> = {}): MosaicRegion {
	return {
		id: 'm1', x: 10, y: 10, width: 20, height: 20,
		mode: 'pixelate', strength: 50, startTime: null, endTime: null,
		...over,
	};
}

describe('keeping a region on screen', () => {
	it('leaves a region that already fits', () => {
		expect(clampRegion(box(10, 10, 20, 20))).toEqual(box(10, 10, 20, 20));
	});

	it('pulls one back inside the right edge', () => {
		expect(clampRegion(box(95, 10, 20, 20))).toEqual(box(80, 10, 20, 20));
	});

	it('pulls one back inside the top', () => {
		expect(clampRegion(box(10, -30, 20, 20))).toEqual(box(10, 0, 20, 20));
	});

	it('never lets a region vanish', () => {
		// A zero-width crop reaches the export as an expression FFmpeg rejects.
		expect(clampRegion(box(10, 10, 0, 0)).width).toBe(MIN_REGION_PERCENT);
	});

	it('never lets a region exceed the frame', () => {
		expect(clampRegion(box(0, 0, 500, 500))).toEqual(box(0, 0, 100, 100));
	});
});

describe('moving a region', () => {
	it('follows the pointer', () => {
		expect(moveRegion(region(), 5, -5)).toEqual(box(15, 5, 20, 20));
	});

	it('stops at the edge rather than going off screen', () => {
		expect(moveRegion(region(), 200, 0).x).toBe(80);
	});

	it('keeps its size while being pushed against an edge', () => {
		const moved = moveRegion(region(), -200, 0);
		expect(moved.x).toBe(0);
		expect(moved.width).toBe(20);
	});
});

describe('resizing from a handle', () => {
	it('drags the east edge without moving the west one', () => {
		const resized = resizeRegion(region(), 'e', 10, 0);
		expect(resized.x).toBe(10);
		expect(resized.width).toBe(30);
	});

	it('drags the west edge without moving the east one', () => {
		const resized = resizeRegion(region(), 'w', 5, 0);
		expect(resized.x).toBe(15);
		expect(resized.width).toBe(15);
	});

	it('drags a corner in both axes at once', () => {
		const resized = resizeRegion(region(), 'se', 10, 10);
		expect(resized).toEqual(box(10, 10, 30, 30));
	});

	it('will not invert a region dragged past its opposite edge', () => {
		// A negative width is a crop expression FFmpeg refuses outright.
		const resized = resizeRegion(region(), 'w', 100, 0);
		expect(resized.width).toBeGreaterThanOrEqual(MIN_REGION_PERCENT);
		expect(resized.x).toBeLessThanOrEqual(30 - MIN_REGION_PERCENT);
	});

	it('will not invert on the other side either', () => {
		const resized = resizeRegion(region(), 'n', 100, 100);
		expect(resized.height).toBeGreaterThanOrEqual(MIN_REGION_PERCENT);
	});

	it('treats the body as a move', () => {
		expect(resizeRegion(region(), 'move', 5, 5)).toEqual(box(15, 15, 20, 20));
	});
});

describe('deciding what the pointer grabbed', () => {
	it('finds the body', () => {
		expect(handleAt(region(), 20, 20)).toBe('move');
	});

	it('finds an edge', () => {
		expect(handleAt(region(), 20, 10)).toBe('n');
		expect(handleAt(region(), 30, 20)).toBe('e');
	});

	it('prefers a corner to an edge', () => {
		// A corner is the harder target, so it wins where they overlap.
		expect(handleAt(region(), 10, 10)).toBe('nw');
		expect(handleAt(region(), 30, 30)).toBe('se');
	});

	it('finds nothing well outside the region', () => {
		expect(handleAt(region(), 60, 60)).toBeNull();
	});

	it('is forgiving just outside an edge, so the handle can be hit', () => {
		expect(handleAt(region(), 9, 20)).toBe('w');
	});
});

describe('picking between overlapping regions', () => {
	it('takes the topmost', () => {
		// Last in the list draws last, so it is the one under the pointer.
		const under = region({ id: 'under', x: 10, y: 10, width: 40, height: 40 });
		const over = region({ id: 'over', x: 15, y: 15, width: 20, height: 20 });

		expect(regionAt([under, over], 25, 25)?.region.id).toBe('over');
	});

	it('falls through to the one below when the top is missed', () => {
		const under = region({ id: 'under', x: 10, y: 10, width: 40, height: 40 });
		const over = region({ id: 'over', x: 60, y: 60, width: 20, height: 20 });

		expect(regionAt([under, over], 20, 20)?.region.id).toBe('under');
	});

	it('finds nothing on empty frame', () => {
		expect(regionAt([], 50, 50)).toBeNull();
	});
});

describe('telling the user what will happen', () => {
	it('names a cursor per handle', () => {
		expect(cursorFor('move')).toBe('move');
		expect(cursorFor('nw')).toBe('nwse-resize');
		expect(cursorFor('ne')).toBe('nesw-resize');
		expect(cursorFor('n')).toBe('ns-resize');
		expect(cursorFor('w')).toBe('ew-resize');
		expect(cursorFor(null)).toBe('default');
	});
});
