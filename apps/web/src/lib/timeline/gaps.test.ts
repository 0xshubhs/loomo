import { describe, it, expect } from 'vitest';
import { findGaps, gapAt, clipAt, gapDuration } from './gaps.js';
import type { Clip, Track } from '$lib/types/index.js';

function clip(id: string, start: number, duration: number): Clip {
	return { id, timelineStart: start, duration } as Clip;
}

function track(clips: Clip[]): Track {
	return { id: 't1', name: 'Video 1', type: 'video', clips } as Track;
}

describe('findGaps', () => {
	it('finds nothing when clips are flush', () => {
		expect(findGaps(track([clip('a', 0, 5), clip('b', 5, 5)]))).toEqual([]);
	});

	it('finds a gap between two clips', () => {
		const gaps = findGaps(track([clip('a', 0, 5), clip('b', 8, 5)]));
		expect(gaps).toHaveLength(1);
		expect(gaps[0]).toMatchObject({ start: 5, end: 8, nextClipId: 'b' });
		expect(gapDuration(gaps[0])).toBe(3);
	});

	it('ignores leading space before the first clip', () => {
		// Space at the head is a deliberate offset, not a gap between clips.
		expect(findGaps(track([clip('a', 10, 5)]))).toEqual([]);
	});

	it('finds several gaps in order', () => {
		const gaps = findGaps(track([clip('a', 0, 2), clip('b', 5, 2), clip('c', 10, 2)]));
		expect(gaps.map((g) => [g.start, g.end])).toEqual([[2, 5], [7, 10]]);
	});

	it('tolerates unsorted clips', () => {
		const gaps = findGaps(track([clip('c', 10, 2), clip('a', 0, 2), clip('b', 5, 2)]));
		expect(gaps.map((g) => g.nextClipId)).toEqual(['b', 'c']);
	});

	it('does not report a gap for overlapping clips', () => {
		// b starts before a ends; that is an overlap, not empty space.
		expect(findGaps(track([clip('a', 0, 10), clip('b', 4, 3)]))).toEqual([]);
	});

	it('does not let a short clip inside a long one create a false gap', () => {
		// Without tracking the furthest reach, c would look like it followed b.
		const gaps = findGaps(track([clip('a', 0, 20), clip('b', 2, 1), clip('c', 25, 2)]));
		expect(gaps.map((g) => [g.start, g.end])).toEqual([[20, 25]]);
	});

	it('ignores sub-millisecond slivers from float drift', () => {
		expect(findGaps(track([clip('a', 0, 5), clip('b', 5.0000001, 5)]))).toEqual([]);
	});

	it('handles an empty track', () => {
		expect(findGaps(track([]))).toEqual([]);
	});
});

describe('gapAt', () => {
	const t = track([clip('a', 0, 5), clip('b', 8, 5)]);

	it('finds the gap under a click inside it', () => {
		expect(gapAt(t, 6)?.nextClipId).toBe('b');
	});

	it('is null over a clip', () => {
		expect(gapAt(t, 2)).toBeNull();
		expect(gapAt(t, 9)).toBeNull();
	});

	it('is inclusive of the start and exclusive of the end', () => {
		expect(gapAt(t, 5)).not.toBeNull();
		expect(gapAt(t, 8)).toBeNull();
	});
});

describe('clipAt', () => {
	const t = track([clip('a', 0, 5), clip('b', 8, 5)]);

	it('finds the clip under the cursor', () => {
		expect(clipAt(t, 3)?.id).toBe('a');
		expect(clipAt(t, 12)?.id).toBe('b');
	});

	it('is null in a gap', () => {
		expect(clipAt(t, 6)).toBeNull();
	});

	it('excludes the exact end boundary so adjacent clips do not both match', () => {
		expect(clipAt(t, 5)).toBeNull();
	});
});
