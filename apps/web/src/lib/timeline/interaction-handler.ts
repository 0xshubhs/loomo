import type { Track, Clip } from '$lib/types/index.js';
import { getClipAtPosition, getSnapPoints, findNearestSnap, getTrackIndexFromY } from './timeline-engine.js';

export type DragMode = 'none' | 'move' | 'trim-start' | 'trim-end' | 'playhead' | 'select';

export interface DragState {
	mode: DragMode;
	clipId: string | null;
	trackId: string | null;
	startX: number;
	startY: number;
	startTime: number;
	currentX: number;
	currentY: number;
	snapTime: number | null;
}

export function createDragState(): DragState {
	return {
		mode: 'none',
		clipId: null,
		trackId: null,
		startX: 0,
		startY: 0,
		startTime: 0,
		currentX: 0,
		currentY: 0,
		snapTime: null,
	};
}

export function handleMouseDown(
	e: MouseEvent,
	tracks: Track[],
	pixelsPerSecond: number,
	scrollX: number,
	scrollY: number,
	trackHeight: number,
	trackGap: number,
	rulerHeight: number,
	currentTime: number
): DragState {
	const rect = (e.target as HTMLElement).getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	// Ruler click = playhead scrub
	if (y < rulerHeight) {
		const time = Math.max(0, (x + scrollX) / pixelsPerSecond);
		return {
			mode: 'playhead',
			clipId: null,
			trackId: null,
			startX: x,
			startY: y,
			startTime: time,
			currentX: x,
			currentY: y,
			snapTime: null,
		};
	}

	// Check clip hit
	const hit = getClipAtPosition(tracks, x, y, pixelsPerSecond, scrollX, scrollY, trackHeight, trackGap, rulerHeight);

	if (hit) {
		const mode: DragMode =
			hit.edge === 'start' ? 'trim-start' :
			hit.edge === 'end' ? 'trim-end' :
			'move';

		return {
			mode,
			clipId: hit.clip.id,
			trackId: hit.track.id,
			startX: x,
			startY: y,
			startTime: hit.clip.timelineStart,
			currentX: x,
			currentY: y,
			snapTime: null,
		};
	}

	return {
		mode: 'select',
		clipId: null,
		trackId: null,
		startX: x,
		startY: y,
		startTime: (x + scrollX) / pixelsPerSecond,
		currentX: x,
		currentY: y,
		snapTime: null,
	};
}

export function handleMouseMove(
	e: MouseEvent,
	dragState: DragState,
	tracks: Track[],
	pixelsPerSecond: number,
	scrollX: number,
	snapEnabled: boolean,
	snapThreshold: number = 0.1
): DragState {
	if (dragState.mode === 'none') return dragState;

	const rect = (e.target as HTMLElement).getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;
	const deltaX = x - dragState.startX;
	const deltaTime = deltaX / pixelsPerSecond;

	let snapTime: number | null = null;

	if (dragState.mode === 'move' && dragState.clipId && snapEnabled) {
		const newStart = dragState.startTime + deltaTime;
		const snapPoints = getSnapPoints(tracks, dragState.clipId);
		const snap = findNearestSnap(newStart, snapPoints, snapThreshold);
		if (snap.snapped) snapTime = snap.time;
	}

	return {
		...dragState,
		currentX: x,
		currentY: y,
		snapTime,
	};
}

export function getCursorForPosition(
	tracks: Track[],
	x: number,
	y: number,
	pixelsPerSecond: number,
	scrollX: number,
	scrollY: number,
	trackHeight: number,
	trackGap: number,
	rulerHeight: number
): string {
	if (y < rulerHeight) return 'col-resize';

	const hit = getClipAtPosition(tracks, x, y, pixelsPerSecond, scrollX, scrollY, trackHeight, trackGap, rulerHeight);
	if (!hit) return 'default';

	switch (hit.edge) {
		case 'start':
		case 'end':
			return 'col-resize';
		case 'body':
			return 'grab';
	}
}
