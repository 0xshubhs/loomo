import { describe, it, expect } from 'vitest';
import {
	clampStart,
	clampMoveDelta,
	clampTrimDelta,
	isMeaningfulDelta,
	MIN_CLIP_DURATION,
} from './clip-bounds.js';

/**
 * None of these limits were enforced. A clip dragged left from the start of
 * the timeline kept going past zero — it slid off the left edge and read as
 * the clip being cropped, when in fact it had a negative start that the export
 * would then have to make sense of.
 */

function clip(over: Partial<{ timelineStart: number; duration: number; sourceStart: number; sourceEnd: number }> = {}) {
	return { timelineStart: 10, duration: 5, sourceStart: 2, sourceEnd: 7, ...over };
}

describe('where a clip may start', () => {
	it('leaves an ordinary position alone', () => {
		expect(clampStart(4)).toBe(4);
	});

	it('stops at the beginning of the timeline', () => {
		expect(clampStart(-3)).toBe(0);
	});

	it('allows exactly zero', () => {
		expect(clampStart(0)).toBe(0);
	});
});

describe('moving a clip or a group', () => {
	it('applies a move that stays inside the timeline', () => {
		expect(clampMoveDelta(-2, [10])).toBe(-2);
	});

	it('stops a leftward move at the start', () => {
		expect(clampMoveDelta(-30, [10])).toBe(-10);
	});

	it('refuses to move a clip already at zero any further left', () => {
		// The reported bug: it kept going, and kept looking like a crop.
		expect(clampMoveDelta(-5, [0])).toBe(0);
	});

	it('never bounds a move to the right', () => {
		expect(clampMoveDelta(9999, [0])).toBe(9999);
	});

	it('holds a group together at the boundary', () => {
		// Clamping each clip on its own would leave the leftmost at zero while
		// the others kept sliding, tearing the group apart.
		expect(clampMoveDelta(-30, [4, 12, 20])).toBe(-4);
	});

	it('leaves a move alone when there is nothing to move', () => {
		expect(clampMoveDelta(-5, [])).toBe(-5);
	});
});

describe('trimming the start handle', () => {
	it('applies an ordinary trim', () => {
		expect(clampTrimDelta(clip(), 'start', 1)).toBe(1);
	});

	it('will not drag the clip before the timeline start', () => {
		expect(clampTrimDelta(clip({ timelineStart: 3, sourceStart: 100 }), 'start', -10)).toBe(-3);
	});

	it('will not seek before the beginning of the media', () => {
		// ffmpeg cannot seek to a negative time; it would silently start at 0
		// and everything after would be a frame out.
		expect(clampTrimDelta(clip({ timelineStart: 100, sourceStart: 2 }), 'start', -10)).toBe(-2);
	});

	it('takes whichever floor is nearer', () => {
		expect(clampTrimDelta(clip({ timelineStart: 4, sourceStart: 9 }), 'start', -20)).toBe(-4);
		expect(clampTrimDelta(clip({ timelineStart: 9, sourceStart: 4 }), 'start', -20)).toBe(-4);
	});

	it('leaves at least one frame when trimming inward', () => {
		expect(clampTrimDelta(clip({ duration: 5 }), 'start', 99)).toBeCloseTo(5 - MIN_CLIP_DURATION);
	});

	it('cannot invert a clip', () => {
		const trimmed = clip({ duration: 5 });
		const delta = clampTrimDelta(trimmed, 'start', 99);

		expect(trimmed.duration - delta).toBeGreaterThan(0);
	});
});

describe('trimming the end handle', () => {
	it('applies an ordinary trim', () => {
		expect(clampTrimDelta(clip(), 'end', -1, { sourceDuration: 60 })).toBe(-1);
	});

	it('will not extend past the end of the media', () => {
		// There are no frames there. The export would come up short.
		expect(clampTrimDelta(clip({ sourceEnd: 7 }), 'end', 100, { sourceDuration: 10 })).toBe(3);
	});

	it('will not extend at all when the clip already reaches the end', () => {
		expect(clampTrimDelta(clip({ sourceEnd: 10 }), 'end', 5, { sourceDuration: 10 })).toBe(0);
	});

	it('leaves at least one frame when trimming inward', () => {
		expect(clampTrimDelta(clip({ duration: 5 }), 'end', -99, { sourceDuration: 60 })).toBeCloseTo(
			MIN_CLIP_DURATION - 5
		);
	});

	it('still bounds the minimum when the source length is unknown', () => {
		// An asset that never reported a duration should still not be
		// trimmable into a negative-length clip.
		expect(clampTrimDelta(clip({ duration: 5 }), 'end', -99)).toBeCloseTo(MIN_CLIP_DURATION - 5);
	});

	it('allows extending when the source length is unknown', () => {
		// Refusing outright would be worse than allowing it.
		expect(clampTrimDelta(clip(), 'end', 5)).toBe(5);
	});
});

describe('deciding whether to record an edit', () => {
	it('ignores a delta that rounds to nothing', () => {
		// A clamped drag against a boundary produces exactly this, and it must
		// not land on the undo stack as an edit that changed nothing.
		expect(isMeaningfulDelta(0)).toBe(false);
		expect(isMeaningfulDelta(0.0001)).toBe(false);
	});

	it('accepts a real one', () => {
		expect(isMeaningfulDelta(0.5)).toBe(true);
		expect(isMeaningfulDelta(-0.5)).toBe(true);
	});
});
