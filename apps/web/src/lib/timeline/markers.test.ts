import { describe, it, expect } from 'vitest';
import {
	addMarker,
	removeMarker,
	renameMarker,
	moveMarker,
	markerAt,
	nextMarker,
	previousMarker,
} from './markers.js';
import { getSnapPoints, findNearestSnap } from './timeline-engine.js';
import { createClip } from '$lib/types/timeline.js';
import type { Marker, Track } from '$lib/types/index.js';

/**
 * Markers were in the keyboard map and wired to nothing — `M` did precisely
 * nothing for the whole life of the app. These are the rules the shortcut now
 * follows.
 */

function marker(over: Partial<Marker> & { time: number }): Marker {
	return { id: `m${over.time}`, label: 'Marker', color: '#fff', ...over };
}

describe('adding', () => {
	it('places a marker at the given time', () => {
		expect(addMarker([], 4.5)[0].time).toBe(4.5);
	});

	it('names it after its position in the list', () => {
		const markers = addMarker(addMarker([], 1), 2);

		expect(markers.map((m) => m.label)).toEqual(['Marker 1', 'Marker 2']);
	});

	it('takes a label when one is given', () => {
		expect(addMarker([], 1, { label: 'Chorus' })[0].label).toBe('Chorus');
	});

	it('ignores a second marker at the same point', () => {
		// Pressing M twice on the same frame is a slip, not a request for two
		// markers hidden underneath each other.
		const once = addMarker([], 3);

		expect(addMarker(once, 3)).toBe(once);
	});

	it('keeps the list in time order however they were added', () => {
		const markers = addMarker(addMarker(addMarker([], 5), 1), 3);

		expect(markers.map((m) => m.time)).toEqual([1, 3, 5]);
	});

	it('clamps a negative time to the start', () => {
		expect(addMarker([], -2)[0].time).toBe(0);
	});

	it('gives consecutive markers different colours', () => {
		const markers = addMarker(addMarker([], 1), 2);

		expect(markers[0].color).not.toBe(markers[1].color);
	});

	it('does not mutate the list it was given', () => {
		const original: Marker[] = [];

		addMarker(original, 1);

		expect(original).toEqual([]);
	});
});

describe('editing', () => {
	it('removes by id', () => {
		const markers = [marker({ time: 1 }), marker({ time: 2 })];

		expect(removeMarker(markers, 'm1').map((m) => m.time)).toEqual([2]);
	});

	it('leaves the list alone when the id is unknown', () => {
		const markers = [marker({ time: 1 })];

		expect(removeMarker(markers, 'nope')).toHaveLength(1);
	});

	it('renames', () => {
		const markers = [marker({ time: 1 })];

		expect(renameMarker(markers, 'm1', 'Chorus')[0].label).toBe('Chorus');
	});

	it('re-sorts after a move', () => {
		const markers = [marker({ time: 1 }), marker({ time: 2 })];

		expect(moveMarker(markers, 'm1', 9).map((m) => m.time)).toEqual([2, 9]);
	});

	it('clamps a move past the start', () => {
		expect(moveMarker([marker({ time: 5 })], 'm5', -3)[0].time).toBe(0);
	});
});

describe('finding', () => {
	const markers = [marker({ time: 1 }), marker({ time: 5 }), marker({ time: 9 })];

	it('finds the marker under the playhead', () => {
		expect(markerAt(markers, 5)?.time).toBe(5);
	});

	it('finds nothing between markers', () => {
		expect(markerAt(markers, 3)).toBeNull();
	});

	it('accepts a tolerance, for clicking near one', () => {
		expect(markerAt(markers, 5.2, 0.5)?.time).toBe(5);
	});

	it('picks the nearer of two within tolerance', () => {
		const close = [marker({ id: 'a', time: 5 }), marker({ id: 'b', time: 5.3 })];

		expect(markerAt(close, 5.25, 0.5)?.id).toBe('b');
	});
});

describe('walking the list', () => {
	const markers = [marker({ time: 1 }), marker({ time: 5 }), marker({ time: 9 })];

	it('steps forward', () => {
		expect(nextMarker(markers, 2)?.time).toBe(5);
	});

	it('steps backward', () => {
		expect(previousMarker(markers, 7)?.time).toBe(5);
	});

	it('does not stick on the marker it is standing on', () => {
		// Otherwise holding the shortcut goes nowhere.
		expect(nextMarker(markers, 5)?.time).toBe(9);
		expect(previousMarker(markers, 5)?.time).toBe(1);
	});

	it('stops at each end rather than wrapping', () => {
		expect(nextMarker(markers, 9)).toBeNull();
		expect(previousMarker(markers, 1)).toBeNull();
	});

	it('finds nothing in an empty list', () => {
		expect(nextMarker([], 0)).toBeNull();
		expect(previousMarker([], 100)).toBeNull();
	});

	it('works on a list that is not sorted', () => {
		const unsorted = [marker({ time: 9 }), marker({ time: 1 }), marker({ time: 5 })];

		expect(nextMarker(unsorted, 2)?.time).toBe(5);
	});
});

describe('snapping to markers', () => {
	// A marker's job is to be somewhere a clip can land. Rendering a flag and
	// then not snapping to it would make the feature decorative.
	const tracks: Track[] = [
		{
			id: 't1',
			name: 'Video',
			type: 'video',
			clips: [
				createClip({
					id: 'c1', name: 'a.mp4', type: 'video', assetId: 'a1',
					trackId: 't1', timelineStart: 0, duration: 2,
				}),
			],
			muted: false,
			locked: false,
			visible: true,
			height: 80,
			volume: 1,
		},
	];

	it('offers each marker as a snap point', () => {
		const points = getSnapPoints(tracks, undefined, [marker({ time: 7 })]);

		expect(points).toContainEqual({ time: 7, source: 'marker' });
	});

	it('lands a dragged clip on a nearby marker', () => {
		const points = getSnapPoints(tracks, 'c1', [marker({ time: 7 })]);

		expect(findNearestSnap(6.95, points, 0.2)).toEqual({ time: 7, snapped: true });
	});

	it('leaves a clip alone when no marker is near', () => {
		const points = getSnapPoints(tracks, 'c1', [marker({ time: 7 })]);

		expect(findNearestSnap(3, points, 0.2).snapped).toBe(false);
	});

	it('still snaps to clip edges with no markers at all', () => {
		expect(getSnapPoints(tracks).map((p) => p.time)).toEqual([0, 2]);
	});
});
