import type { Marker } from '$lib/types/index.js';
import { generateId } from '$lib/utils/id.js';

/**
 * Timeline markers.
 *
 * A marker is a named point in time: where the chorus starts, where the demo
 * goes wrong, where a cut is wanted later. They hold no media and change
 * nothing about the render — they exist so an edit can be planned before it is
 * made, and so a long timeline can be navigated by meaning instead of by
 * scrubbing.
 *
 * Everything here is pure. The store keeps the array; this decides what the
 * array should become.
 */

/** Two markers closer together than this are treated as the same point. */
export const MARKER_EPSILON = 0.001;

const COLORS = ['#ffb347', '#4ecdc4', '#ff6b6b', '#a06cd5', '#54a0ff', '#ffe66d'] as const;

/**
 * Adds a marker, or returns the list unchanged if one is already there.
 *
 * Pressing M twice at the same frame is a slip, not a request for two
 * markers stacked invisibly on top of each other.
 */
export function addMarker(
	markers: Marker[],
	time: number,
	options: { label?: string; id?: string } = {}
): Marker[] {
	const at = Math.max(0, time);
	if (markerAt(markers, at)) return markers;

	const marker: Marker = {
		id: options.id ?? generateId(),
		time: at,
		label: options.label ?? `Marker ${markers.length + 1}`,
		color: COLORS[markers.length % COLORS.length],
	};

	return sortMarkers([...markers, marker]);
}

export function removeMarker(markers: Marker[], id: string): Marker[] {
	return markers.filter((m) => m.id !== id);
}

export function renameMarker(markers: Marker[], id: string, label: string): Marker[] {
	return markers.map((m) => (m.id === id ? { ...m, label } : m));
}

/** Moves a marker, keeping the list in time order. */
export function moveMarker(markers: Marker[], id: string, time: number): Marker[] {
	return sortMarkers(markers.map((m) => (m.id === id ? { ...m, time: Math.max(0, time) } : m)));
}

/** The marker at a given time, within `tolerance` seconds. */
export function markerAt(
	markers: Marker[],
	time: number,
	tolerance: number = MARKER_EPSILON
): Marker | null {
	let nearest: Marker | null = null;
	let best = Infinity;

	for (const marker of markers) {
		const distance = Math.abs(marker.time - time);
		if (distance <= tolerance && distance < best) {
			best = distance;
			nearest = marker;
		}
	}

	return nearest;
}

/**
 * The next marker strictly after `time`, or null at the end.
 *
 * Strictly after, so holding the shortcut walks the list instead of sticking
 * on the marker the playhead has just landed on.
 */
export function nextMarker(markers: Marker[], time: number): Marker | null {
	let best: Marker | null = null;
	for (const marker of markers) {
		if (marker.time > time + MARKER_EPSILON && (!best || marker.time < best.time)) best = marker;
	}
	return best;
}

/** The nearest marker strictly before `time`, or null at the start. */
export function previousMarker(markers: Marker[], time: number): Marker | null {
	let best: Marker | null = null;
	for (const marker of markers) {
		if (marker.time < time - MARKER_EPSILON && (!best || marker.time > best.time)) best = marker;
	}
	return best;
}

function sortMarkers(markers: Marker[]): Marker[] {
	return [...markers].sort((a, b) => a.time - b.time);
}
