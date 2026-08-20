import { describe, it, expect } from 'vitest';
import { TimelineStore } from '$lib/state/timeline.svelte.js';
import { MoveClipCommand, TrimClipCommand } from './clip-commands.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip } from '$lib/types/timeline.js';

/**
 * A clip dragged left from the start of the timeline used to keep going. It
 * slid off the left edge and read as the clip being cropped, when what had
 * actually happened is that it now had a negative start — which the export
 * would then have to make sense of.
 *
 * These go through the commands rather than the drag handler, because the
 * commands are what every other route uses too.
 */

function storeWith(over: Partial<Clip> = {}): { timeline: TimelineStore; clip: Clip } {
	const timeline = new TimelineStore();
	const clip = createClip({
		id: 'c1',
		name: 'a.mp4',
		type: 'video',
		assetId: 'a1',
		trackId: 't1',
		timelineStart: 10,
		duration: 5,
		sourceStart: 2,
		sourceEnd: 7,
		...over,
	});
	timeline.tracks = [
		{
			id: 't1', name: 'Video', type: 'video', clips: [clip],
			muted: false, locked: false, visible: true, height: 80, volume: 1,
		},
	];
	return { timeline, clip: timeline.getClipById('c1')! };
}

describe('moving a clip', () => {
	it('moves it where it was asked to go', () => {
		const { timeline } = storeWith();

		new MoveClipCommand(timeline, 'c1', 4).execute();

		expect(timeline.getClipById('c1')!.timelineStart).toBe(4);
	});

	it('stops at the start of the timeline', () => {
		const { timeline } = storeWith();

		new MoveClipCommand(timeline, 'c1', -8).execute();

		expect(timeline.getClipById('c1')!.timelineStart).toBe(0);
	});

	it('puts it back where it was on undo', () => {
		const { timeline } = storeWith();
		const command = new MoveClipCommand(timeline, 'c1', -8);

		command.execute();
		command.undo();

		expect(timeline.getClipById('c1')!.timelineStart).toBe(10);
	});
});

describe('trimming the start handle', () => {
	it('trims inward normally', () => {
		const { timeline } = storeWith();

		new TrimClipCommand(timeline, 'c1', 'start', 1).execute();

		const clip = timeline.getClipById('c1')!;
		expect(clip.timelineStart).toBe(11);
		expect(clip.sourceStart).toBe(3);
		expect(clip.duration).toBe(4);
	});

	it('will not drag the clip before the timeline start', () => {
		const { timeline } = storeWith({ timelineStart: 3, sourceStart: 100, sourceEnd: 105 });

		new TrimClipCommand(timeline, 'c1', 'start', -50).execute();

		expect(timeline.getClipById('c1')!.timelineStart).toBe(0);
	});

	it('will not seek before the beginning of the media', () => {
		// ffmpeg cannot seek to a negative time. It would start at zero
		// instead, silently, and everything after would be out.
		const { timeline } = storeWith({ timelineStart: 100, sourceStart: 2 });

		new TrimClipCommand(timeline, 'c1', 'start', -50).execute();

		expect(timeline.getClipById('c1')!.sourceStart).toBe(0);
	});

	it('never trims a clip out of existence', () => {
		const { timeline } = storeWith();

		new TrimClipCommand(timeline, 'c1', 'start', 99).execute();

		expect(timeline.getClipById('c1')!.duration).toBeGreaterThan(0);
	});
});

describe('trimming the end handle', () => {
	it('trims inward normally', () => {
		const { timeline } = storeWith();

		new TrimClipCommand(timeline, 'c1', 'end', -1, { sourceDuration: 60 }).execute();

		expect(timeline.getClipById('c1')!.duration).toBe(4);
	});

	it('will not extend past the end of the media', () => {
		const { timeline } = storeWith({ sourceEnd: 7 });

		new TrimClipCommand(timeline, 'c1', 'end', 50, { sourceDuration: 10 }).execute();

		expect(timeline.getClipById('c1')!.sourceEnd).toBe(10);
	});

	it('never trims a clip to a negative length', () => {
		const { timeline } = storeWith();

		new TrimClipCommand(timeline, 'c1', 'end', -99, { sourceDuration: 60 }).execute();

		expect(timeline.getClipById('c1')!.duration).toBeGreaterThan(0);
	});

	it('restores the exact original on undo, however hard it was clamped', () => {
		const { timeline } = storeWith();
		const command = new TrimClipCommand(timeline, 'c1', 'end', -99, { sourceDuration: 60 });

		command.execute();
		command.undo();

		const clip = timeline.getClipById('c1')!;
		expect(clip.duration).toBe(5);
		expect(clip.sourceEnd).toBe(7);
	});
});
