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

/**
 * Moves every marker at or after `from` by `delta`.
 *
 * A marker names a moment in the footage — where the demo goes wrong, where the
 * chorus starts. The moment is the point of it, not the number of seconds, so
 * when an edit slides footage along the timeline the markers over that footage
 * have to travel with it. Closing a three-second gap at ten seconds and leaving
 * the markers behind makes every note after ten seconds three seconds late.
 *
 * Markers before `from` sit over footage that did not move, so they do not
 * move.
 *
 * Nothing lands before `from` itself. That is what becomes of a marker that was
 * standing in the space being deleted: there is no longer anything there for it
 * to point at, so it settles on the seam the edit leaves behind rather than
 * jumping backwards into footage it never marked.
 */
export function shiftMarkersAfter(markers: Marker[], from: number, delta: number): Marker[] {
	if (delta === 0) return markers;

	const floor = Math.max(0, from);

	return sortMarkers(
		markers.map((marker) =>
			marker.time >= from - MARKER_EPSILON
				? { ...marker, time: Math.max(floor, marker.time + delta) }
				: marker
		)
	);
}

/**
 * Re-times markers around a clip whose length on the timeline has changed.
 *
 * Speed is the awkward case. At 2x the same frames occupy half as much
 * timeline, so a marker halfway through the clip is still halfway through the
 * footage but is now half as far from the clip's start in seconds. Shifting
 * only the markers after the clip would leave that one pointing past the clip's
 * new end, at whatever happens to be there instead.
 *
 * `rippleAfter` is off when the clip is retimed on its own and its neighbours
 * stay put; the markers past it are then still over footage that has not moved.
 */
export function retimeMarkers(
	markers: Marker[],
	start: number,
	oldDuration: number,
	newDuration: number,
	rippleAfter = true
): Marker[] {
	// A zero-length clip gives no ratio to scale by, and there is no interval
	// for a marker to be inside in the first place.
	if (oldDuration <= 0) return markers;

	const oldEnd = start + oldDuration;
	const scale = newDuration / oldDuration;

	return sortMarkers(
		markers.map((marker) => {
			if (marker.time < start - MARKER_EPSILON) return marker;

			if (marker.time < oldEnd - MARKER_EPSILON) {
				return { ...marker, time: Math.max(0, start + (marker.time - start) * scale) };
			}

			if (!rippleAfter) return marker;
			return { ...marker, time: Math.max(0, marker.time + (newDuration - oldDuration)) };
		})
	);
}

/** Where a run of footage sat before an edit, and where it sits after it. */
export interface MovedSpan {
	/** The footage's old start on the timeline. */
	from: number;
	/** Its new start. */
	to: number;
	/** Its length, which a repack does not change. */
	duration: number;
}

/**
 * Re-times markers against footage that has been rearranged wholesale.
 *
 * "Remove gaps" repacks a whole track in one go: every clip moves by a
 * different amount, so there is no single delta to shift by and each marker has
 * to be looked up in the footage it was standing over.
 *
 * A marker inside a clip keeps its offset into that clip. A marker in space
 * that has just been deleted — a closed gap, or the run-up before the first
 * clip, which the repack also removes — has nothing left to point at, so it
 * lands on the new start of the clip that followed it. A marker past the last
 * clip keeps its distance from the end of the edit, so a note written after the
 * footage stays the same distance beyond it.
 *
 * Two tracks packed at once can disagree about where the footage under a marker
 * went. The earliest-starting clip covering the marker wins. That is arbitrary
 * in principle, but it is the same answer every time, and it is the obviously
 * right one whenever the tracks were lined up to begin with — which is the
 * usual case, since they are normally cut from the same take.
 */
export function remapMarkers(markers: Marker[], spans: MovedSpan[]): Marker[] {
	if (spans.length === 0) return markers;

	const ordered = [...spans].sort((a, b) => a.from - b.from);

	return sortMarkers(
		markers.map((marker) => ({ ...marker, time: remapTime(marker.time, ordered) }))
	);
}

function remapTime(time: number, ordered: MovedSpan[]): number {
	for (const span of ordered) {
		if (time < span.from - MARKER_EPSILON) return Math.max(0, span.to);
		if (time < span.from + span.duration - MARKER_EPSILON) {
			return Math.max(0, span.to + (time - span.from));
		}
	}

	const last = ordered[ordered.length - 1];
	return Math.max(0, time + (last.to - last.from));
}

function sortMarkers(markers: Marker[]): Marker[] {
	return [...markers].sort((a, b) => a.time - b.time);
}
