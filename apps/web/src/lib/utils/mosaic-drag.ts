import type { MosaicRegion } from '$lib/types/timeline.js';

/**
 * Dragging a mosaic on the preview.
 *
 * Regions were slider-only: four numbers to nudge while looking at a face you
 * are trying to cover. Placing a box by typing percentages is the kind of task
 * a mouse exists for, and the annotation layer already proved the preview can
 * take pointer input.
 *
 * Everything here is percentages of the frame, which is what `MosaicRegion`
 * stores and what the export's filtergraph reads, so the numbers a drag
 * produces are the same numbers the sliders produce.
 */

/** Corner and edge handles, plus the body for moving the whole region. */
export type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

/** Smallest region worth having, in percent. Below this it cannot be grabbed. */
export const MIN_REGION_PERCENT = 2;

/** How close to an edge counts as grabbing it, in percent of the frame. */
export const HANDLE_TOLERANCE_PERCENT = 3;

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Clamps a region to the frame, never letting it invert or vanish. */
export function clampRegion(box: Box): Box {
	const width = Math.min(Math.max(box.width, MIN_REGION_PERCENT), 100);
	const height = Math.min(Math.max(box.height, MIN_REGION_PERCENT), 100);
	return {
		width,
		height,
		x: Math.min(Math.max(box.x, 0), 100 - width),
		y: Math.min(Math.max(box.y, 0), 100 - height),
	};
}

/** Moves a region, keeping it inside the frame. */
export function moveRegion(region: Box, dxPercent: number, dyPercent: number): Box {
	return clampRegion({ ...region, x: region.x + dxPercent, y: region.y + dyPercent });
}

/**
 * Resizes from one handle.
 *
 * The opposite edge stays put, which is what makes a corner drag feel like a
 * corner drag. Dragging an edge past its opposite would invert the box, so the
 * minimum size stops it there instead of letting the width go negative — a
 * negative width reaches the export as a crop expression FFmpeg rejects.
 */
export function resizeRegion(
	region: Box,
	handle: DragHandle,
	dxPercent: number,
	dyPercent: number
): Box {
	if (handle === 'move') return moveRegion(region, dxPercent, dyPercent);

	let { x, y, width, height } = region;
	const right = x + width;
	const bottom = y + height;

	if (handle.includes('w')) {
		x = Math.min(x + dxPercent, right - MIN_REGION_PERCENT);
		width = right - x;
	}
	if (handle.includes('e')) {
		width = Math.max(width + dxPercent, MIN_REGION_PERCENT);
	}
	if (handle.includes('n')) {
		y = Math.min(y + dyPercent, bottom - MIN_REGION_PERCENT);
		height = bottom - y;
	}
	if (handle.includes('s')) {
		height = Math.max(height + dyPercent, MIN_REGION_PERCENT);
	}

	return clampRegion({ x, y, width, height });
}

/**
 * Which handle a point is on, or null when the point misses the region.
 *
 * Corners win over edges, because a corner is the harder thing to hit and the
 * one someone reaching for it actually wants.
 */
export function handleAt(region: Box, xPercent: number, yPercent: number): DragHandle | null {
	const t = HANDLE_TOLERANCE_PERCENT;
	const right = region.x + region.width;
	const bottom = region.y + region.height;

	const outside =
		xPercent < region.x - t ||
		xPercent > right + t ||
		yPercent < region.y - t ||
		yPercent > bottom + t;
	if (outside) return null;

	const nearLeft = Math.abs(xPercent - region.x) <= t;
	const nearRight = Math.abs(xPercent - right) <= t;
	const nearTop = Math.abs(yPercent - region.y) <= t;
	const nearBottom = Math.abs(yPercent - bottom) <= t;

	if (nearTop && nearLeft) return 'nw';
	if (nearTop && nearRight) return 'ne';
	if (nearBottom && nearLeft) return 'sw';
	if (nearBottom && nearRight) return 'se';
	if (nearTop) return 'n';
	if (nearBottom) return 's';
	if (nearLeft) return 'w';
	if (nearRight) return 'e';

	// Inside the box proper, which moves the whole thing.
	const inside =
		xPercent > region.x && xPercent < right && yPercent > region.y && yPercent < bottom;
	return inside ? 'move' : null;
}

/** The region under a point, topmost first, so overlapping boxes pick sensibly. */
export function regionAt(
	regions: MosaicRegion[],
	xPercent: number,
	yPercent: number
): { region: MosaicRegion; handle: DragHandle } | null {
	for (let i = regions.length - 1; i >= 0; i--) {
		const handle = handleAt(regions[i], xPercent, yPercent);
		if (handle) return { region: regions[i], handle };
	}
	return null;
}

/** The CSS cursor for a handle, so the box says what it will do. */
export function cursorFor(handle: DragHandle | null): string {
	switch (handle) {
		case 'move': return 'move';
		case 'nw': case 'se': return 'nwse-resize';
		case 'ne': case 'sw': return 'nesw-resize';
		case 'n': case 's': return 'ns-resize';
		case 'e': case 'w': return 'ew-resize';
		default: return 'default';
	}
}
