import { describe, it, expect } from 'vitest';
import { audioBedClips, diffBed, bedSourceTime } from './preview-mixer.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, Track } from '$lib/types/timeline.js';

/**
 * The export mixes every audio track; the preview played one clip on one video
 * track. A music bed was in the file and not in the editor.
 */

function track(over: Partial<Track> & { id: string; clips: Clip[] }): Track {
	return {
		name: 'Audio',
		type: 'audio',
		muted: false,
		locked: false,
		visible: true,
		height: 60,
		volume: 1,
		...over,
	};
}

function clip(over: Partial<Clip> & { id: string; trackId: string }): Clip {
	return createClip({
		name: 'music.m4a',
		type: 'audio',
		assetId: 'a1',
		timelineStart: 0,
		duration: 30,
		...over,
	});
}

describe('what the bed should be playing', () => {
	it('plays an audio clip under the playhead', () => {
		const tracks = [track({ id: 't1', clips: [clip({ id: 'music', trackId: 't1' })] })];

		expect(audioBedClips(tracks, 5).map((b) => b.clip.id)).toEqual(['music']);
	});

	it('plays nothing before the clip starts', () => {
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'music', trackId: 't1', timelineStart: 10 })] }),
		];

		expect(audioBedClips(tracks, 5)).toEqual([]);
	});

	it('folds the track fader into the clip volume, as the export does', () => {
		const tracks = [
			track({ id: 't1', volume: 0.5, clips: [clip({ id: 'music', trackId: 't1', volume: 0.5 })] }),
		];

		expect(audioBedClips(tracks, 5)[0].volume).toBe(0.25);
	});

	it('skips a muted track', () => {
		const tracks = [track({ id: 't1', muted: true, clips: [clip({ id: 'music', trackId: 't1' })] })];

		expect(audioBedClips(tracks, 5)).toEqual([]);
	});

	it('treats a fader at zero as a mute', () => {
		const tracks = [track({ id: 't1', volume: 0, clips: [clip({ id: 'music', trackId: 't1' })] })];

		expect(audioBedClips(tracks, 5)).toEqual([]);
	});

	it('skips a muted clip on an audible track', () => {
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'music', trackId: 't1', muted: true })] }),
		];

		expect(audioBedClips(tracks, 5)).toEqual([]);
	});

	it('ignores video tracks, whose audio the base path already plays', () => {
		const tracks = [
			track({ id: 't1', type: 'video', clips: [clip({ id: 'v', trackId: 't1', type: 'video' })] }),
		];

		expect(audioBedClips(tracks, 5)).toEqual([]);
	});

	it('plays several beds at once', () => {
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'music', trackId: 't1' })] }),
			track({ id: 't2', clips: [clip({ id: 'vo', trackId: 't2' })] }),
		];

		expect(audioBedClips(tracks, 5).map((b) => b.clip.id)).toEqual(['music', 'vo']);
	});
});

describe('keeping the players in step', () => {
	const music = { clip: clip({ id: 'music', trackId: 't1' }), volume: 1 };
	const voice = { clip: clip({ id: 'vo', trackId: 't2' }), volume: 1 };

	it('starts what is not playing yet', () => {
		expect(diffBed([], [music]).start.map((b) => b.clip.id)).toEqual(['music']);
	});

	it('stops what should no longer be playing', () => {
		expect(diffBed(['music'], []).stop).toEqual(['music']);
	});

	it('leaves a clip that is already playing alone', () => {
		// Restarting it every frame would stutter the very music it exists to
		// play.
		const diff = diffBed(['music'], [music]);

		expect(diff.start).toEqual([]);
		expect(diff.stop).toEqual([]);
	});

	it('handles one starting while another stops', () => {
		const diff = diffBed(['music'], [voice]);

		expect(diff.start.map((b) => b.clip.id)).toEqual(['vo']);
		expect(diff.stop).toEqual(['music']);
	});
});

describe('where in the source a bed clip is', () => {
	it('accounts for where the clip sits on the timeline', () => {
		const placed = clip({ id: 'music', trackId: 't1', timelineStart: 10 });

		expect(bedSourceTime(placed, 12)).toBe(2);
	});

	it('accounts for a trimmed start', () => {
		const trimmed = clip({ id: 'music', trackId: 't1', timelineStart: 10, sourceStart: 5 });

		expect(bedSourceTime(trimmed, 12)).toBe(7);
	});
});
