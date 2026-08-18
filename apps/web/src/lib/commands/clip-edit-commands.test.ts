import { describe, it, expect, beforeEach } from 'vitest';
import { CloseGapCommand, TrimToPlayheadCommand } from './clip-commands.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, Track } from '$lib/types/timeline.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

function makeClip(id: string, start: number, duration: number): Clip {
	return createClip({
		id, name: id, type: 'video', assetId: 'a1', trackId: 't1',
		timelineStart: start, duration, sourceStart: 0, sourceEnd: duration,
	});
}

let track: Track;
let timeline: TimelineStore;

beforeEach(() => {
	track = {
		id: 't1', name: 'Video 1', type: 'video', clips: [],
		muted: false, locked: false, visible: true, height: 80, volume: 1,
	};
	timeline = {
		tracks: [track],
		getTrackById: (id: string) => (id === track.id ? track : undefined),
		getClipById: (id: string) => track.clips.find((c) => c.id === id),
	} as unknown as TimelineStore;
});

describe('CloseGapCommand', () => {
	it('slides later clips left by the gap width', () => {
		track.clips = [makeClip('a', 0, 5), makeClip('b', 8, 5)];
		new CloseGapCommand(timeline, 't1', 5, 8).execute();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 5]);
	});

	it('leaves clips before the gap alone', () => {
		track.clips = [makeClip('a', 0, 2), makeClip('b', 2, 2), makeClip('c', 10, 2)];
		new CloseGapCommand(timeline, 't1', 4, 10).execute();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 2, 4]);
	});

	it('shifts every later clip, preserving the spacing between them', () => {
		// Closing one gap must not silently collapse the others.
		track.clips = [makeClip('a', 0, 2), makeClip('b', 10, 2), makeClip('c', 20, 2)];
		new CloseGapCommand(timeline, 't1', 2, 10).execute();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 2, 12]);
	});

	it('restores the original positions on undo', () => {
		track.clips = [makeClip('a', 0, 5), makeClip('b', 8, 5), makeClip('c', 20, 5)];
		const command = new CloseGapCommand(timeline, 't1', 5, 8);
		command.execute();
		command.undo();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 8, 20]);
	});

	it('does nothing for a zero-width gap', () => {
		track.clips = [makeClip('a', 0, 5), makeClip('b', 5, 5)];
		new CloseGapCommand(timeline, 't1', 5, 5).execute();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 5]);
	});

	it('only moves clips that start at or after the gap', () => {
		// A clip that begins before the gap ends is not "after" it, so it stays
		// put — which also means the shift can never drive a start negative.
		track.clips = [makeClip('a', 1, 2), makeClip('b', 100, 2)];
		new CloseGapCommand(timeline, 't1', 3, 100).execute();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([1, 3]);
	});
});

describe('TrimToPlayheadCommand', () => {
	it('trims the start, keeping the tail in place', () => {
		track.clips = [makeClip('a', 10, 10)];
		new TrimToPlayheadCommand(timeline, 'a', 'start', 14).execute();
		const clip = track.clips[0];
		expect(clip.timelineStart).toBe(14);
		expect(clip.duration).toBe(6);
		// The visible content must not jump: source advances with the cut.
		expect(clip.sourceStart).toBe(4);
	});

	it('trims the end, keeping the head in place', () => {
		track.clips = [makeClip('a', 10, 10)];
		new TrimToPlayheadCommand(timeline, 'a', 'end', 14).execute();
		const clip = track.clips[0];
		expect(clip.timelineStart).toBe(10);
		expect(clip.duration).toBe(4);
		expect(clip.sourceEnd).toBe(4);
	});

	it('refuses a trim that would leave nothing', () => {
		track.clips = [makeClip('a', 10, 10)];
		new TrimToPlayheadCommand(timeline, 'a', 'start', 10).execute();
		expect(track.clips[0].duration).toBe(10);

		new TrimToPlayheadCommand(timeline, 'a', 'end', 20).execute();
		expect(track.clips[0].duration).toBe(10);
	});

	it('ignores a playhead outside the clip', () => {
		track.clips = [makeClip('a', 10, 10)];
		new TrimToPlayheadCommand(timeline, 'a', 'start', 3).execute();
		expect(track.clips[0]).toMatchObject({ timelineStart: 10, duration: 10 });
	});

	it('restores everything on undo', () => {
		track.clips = [makeClip('a', 10, 10)];
		const command = new TrimToPlayheadCommand(timeline, 'a', 'start', 14);
		command.execute();
		command.undo();
		expect(track.clips[0]).toMatchObject({
			timelineStart: 10, duration: 10, sourceStart: 0, sourceEnd: 10,
		});
	});

	it('is safe to undo when the trim was refused', () => {
		track.clips = [makeClip('a', 10, 10)];
		const command = new TrimToPlayheadCommand(timeline, 'a', 'start', 10);
		command.execute();
		command.undo();
		expect(track.clips[0]).toMatchObject({ timelineStart: 10, duration: 10 });
	});
});
