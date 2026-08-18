import { describe, it, expect, beforeEach } from 'vitest';
import { SetClipSpeedCommand } from './clip-commands.js';
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
		getClipTrack: () => track,
	} as unknown as TimelineStore;
});

describe('SetClipSpeedCommand', () => {
	it('shortens a clip when sped up', () => {
		// The case from the brief: 76s at 1.5x becomes about 51s.
		track.clips = [makeClip('a', 0, 76)];
		new SetClipSpeedCommand(timeline, 'a', 1.5).execute();
		expect(track.clips[0].speed).toBe(1.5);
		expect(track.clips[0].duration).toBeCloseTo(50.667, 2);
	});

	it('lengthens a clip when slowed down', () => {
		track.clips = [makeClip('a', 0, 10)];
		new SetClipSpeedCommand(timeline, 'a', 0.5).execute();
		expect(track.clips[0].duration).toBeCloseTo(20, 5);
	});

	it('keeps the source range untouched — same frames, different rate', () => {
		track.clips = [makeClip('a', 0, 10)];
		new SetClipSpeedCommand(timeline, 'a', 2).execute();
		expect(track.clips[0].sourceStart).toBe(0);
		expect(track.clips[0].sourceEnd).toBe(10);
	});

	it('ripples later clips up when a clip shortens', () => {
		track.clips = [makeClip('a', 0, 10), makeClip('b', 10, 5), makeClip('c', 15, 5)];
		new SetClipSpeedCommand(timeline, 'a', 2).execute();
		// 'a' halves to 5, so everything after slides back by 5.
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 5, 10]);
	});

	it('ripples later clips down when a clip lengthens', () => {
		track.clips = [makeClip('a', 0, 10), makeClip('b', 10, 5)];
		new SetClipSpeedCommand(timeline, 'a', 0.5).execute();
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 20]);
	});

	it('leaves clips that start before the edited clip ends alone', () => {
		track.clips = [makeClip('a', 0, 4), makeClip('b', 10, 10), makeClip('c', 20, 5)];
		new SetClipSpeedCommand(timeline, 'b', 2).execute();
		// 'a' is earlier and must not move; only 'c' follows 'b'.
		expect(track.clips[0].timelineStart).toBe(0);
		expect(track.clips[2].timelineStart).toBe(15);
	});

	it('can skip the ripple', () => {
		track.clips = [makeClip('a', 0, 10), makeClip('b', 10, 5)];
		new SetClipSpeedCommand(timeline, 'a', 2, false).execute();
		expect(track.clips[1].timelineStart).toBe(10);
	});

	it('restores durations and neighbour positions on undo', () => {
		track.clips = [makeClip('a', 0, 10), makeClip('b', 10, 5), makeClip('c', 15, 5)];
		const command = new SetClipSpeedCommand(timeline, 'a', 2);
		command.execute();
		command.undo();
		expect(track.clips[0]).toMatchObject({ speed: 1, duration: 10 });
		expect(track.clips.map((c) => c.timelineStart)).toEqual([0, 10, 15]);
	});

	it('clamps absurd speeds instead of producing a zero-length clip', () => {
		track.clips = [makeClip('a', 0, 10)];
		new SetClipSpeedCommand(timeline, 'a', 999).execute();
		expect(track.clips[0].speed).toBe(16);
		expect(track.clips[0].duration).toBeGreaterThan(0);

		new SetClipSpeedCommand(timeline, 'a', 0).execute();
		expect(track.clips[0].speed).toBe(0.1);
	});

	it('never moves a rippled clip before zero', () => {
		track.clips = [makeClip('a', 0, 10), makeClip('b', 10, 5)];
		new SetClipSpeedCommand(timeline, 'a', 16).execute();
		expect(track.clips[1].timelineStart).toBeGreaterThanOrEqual(0);
	});
});
