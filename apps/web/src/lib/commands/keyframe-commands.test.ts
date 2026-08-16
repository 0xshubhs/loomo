import { describe, it, expect, beforeEach } from 'vitest';
import {
	SetKeyframeCommand,
	RemoveKeyframeCommand,
	UpdateKeyframeCommand,
	ClearPropertyKeyframesCommand,
	ClearAllKeyframesCommand,
	AddMosaicCommand,
	UpdateMosaicCommand,
	RemoveMosaicCommand,
	SetSpeedCurveCommand,
} from './keyframe-commands.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, MosaicRegion, SpeedCurve } from '$lib/types/timeline.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

/** Just enough TimelineStore for the commands under test. */
function makeTimeline(clip: Clip) {
	return {
		tracks: [{ clips: [clip] }],
		getClipById: (id: string) => (id === clip.id ? clip : undefined),
	} as unknown as TimelineStore;
}

let clip: Clip;
let timeline: TimelineStore;

beforeEach(() => {
	clip = createClip({
		id: 'clip-1',
		name: 'test',
		type: 'video',
		assetId: 'asset-1',
		trackId: 'track-1',
		timelineStart: 0,
		duration: 5,
	});
	timeline = makeTimeline(clip);
});

describe('SetKeyframeCommand', () => {
	it('creates the track on first use', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 150).execute();
		expect(clip.keyframes).toHaveLength(1);
		expect(clip.keyframes[0].property).toBe('scale');
		expect(clip.keyframes[0].keyframes[0]).toMatchObject({ time: 1, value: 150 });
	});

	it('adds to an existing track and keeps it sorted', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 3, 50).execute();
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 100).execute();
		expect(clip.keyframes[0].keyframes.map((k) => k.time)).toEqual([1, 3]);
	});

	it('overwrites rather than stacking at the same time', () => {
		// Setting a value twice at one playhead position is the normal way to
		// correct a keyframe, so it must not leave two behind.
		new SetKeyframeCommand(timeline, 'clip-1', 'opacity', 2, 50).execute();
		new SetKeyframeCommand(timeline, 'clip-1', 'opacity', 2, 80).execute();
		expect(clip.keyframes[0].keyframes).toHaveLength(1);
		expect(clip.keyframes[0].keyframes[0].value).toBe(80);
	});

	it('keeps separate properties in separate tracks', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 0, 100).execute();
		new SetKeyframeCommand(timeline, 'clip-1', 'rotation', 0, 45).execute();
		expect(clip.keyframes.map((t) => t.property).sort()).toEqual(['rotation', 'scale']);
	});

	it('undoes back to no animation at all', () => {
		const command = new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 150);
		command.execute();
		command.undo();
		expect(clip.keyframes).toEqual([]);
	});

	it('undoes to the previous state, not to empty', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 0, 100).execute();
		const second = new SetKeyframeCommand(timeline, 'clip-1', 'scale', 2, 200);
		second.execute();
		second.undo();
		expect(clip.keyframes[0].keyframes).toHaveLength(1);
		expect(clip.keyframes[0].keyframes[0].time).toBe(0);
	});

	it('throws for a missing clip', () => {
		expect(() => new SetKeyframeCommand(timeline, 'nope', 'scale', 0, 1).execute()).toThrow();
	});
});

describe('RemoveKeyframeCommand', () => {
	it('drops the track once its last keyframe goes', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 150).execute();
		const id = clip.keyframes[0].keyframes[0].id;
		new RemoveKeyframeCommand(timeline, 'clip-1', 'scale', id).execute();
		// An empty track would still read as "animated" everywhere else.
		expect(clip.keyframes).toEqual([]);
	});

	it('keeps the track when other keyframes remain', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 150).execute();
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 3, 50).execute();
		const id = clip.keyframes[0].keyframes[0].id;
		new RemoveKeyframeCommand(timeline, 'clip-1', 'scale', id).execute();
		expect(clip.keyframes[0].keyframes).toHaveLength(1);
	});

	it('restores on undo', () => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 150).execute();
		const id = clip.keyframes[0].keyframes[0].id;
		const command = new RemoveKeyframeCommand(timeline, 'clip-1', 'scale', id);
		command.execute();
		command.undo();
		expect(clip.keyframes[0].keyframes).toHaveLength(1);
	});
});

describe('UpdateKeyframeCommand', () => {
	beforeEach(() => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 1, 150).execute();
	});

	it('changes value and easing', () => {
		const id = clip.keyframes[0].keyframes[0].id;
		new UpdateKeyframeCommand(timeline, 'clip-1', 'scale', id, { value: 75, easing: 'ease-in' }).execute();
		expect(clip.keyframes[0].keyframes[0]).toMatchObject({ value: 75, easing: 'ease-in' });
	});

	it('never lets a keyframe go negative in time', () => {
		const id = clip.keyframes[0].keyframes[0].id;
		new UpdateKeyframeCommand(timeline, 'clip-1', 'scale', id, { time: -5 }).execute();
		expect(clip.keyframes[0].keyframes[0].time).toBe(0);
	});

	it('restores on undo', () => {
		const id = clip.keyframes[0].keyframes[0].id;
		const command = new UpdateKeyframeCommand(timeline, 'clip-1', 'scale', id, { value: 10 });
		command.execute();
		command.undo();
		expect(clip.keyframes[0].keyframes[0].value).toBe(150);
	});
});

describe('clearing animation', () => {
	beforeEach(() => {
		new SetKeyframeCommand(timeline, 'clip-1', 'scale', 0, 100).execute();
		new SetKeyframeCommand(timeline, 'clip-1', 'opacity', 0, 50).execute();
	});

	it('clears one property and leaves the rest', () => {
		new ClearPropertyKeyframesCommand(timeline, 'clip-1', 'scale').execute();
		expect(clip.keyframes.map((t) => t.property)).toEqual(['opacity']);
	});

	it('clears everything', () => {
		new ClearAllKeyframesCommand(timeline, 'clip-1').execute();
		expect(clip.keyframes).toEqual([]);
	});

	it('restores everything on undo', () => {
		const command = new ClearAllKeyframesCommand(timeline, 'clip-1');
		command.execute();
		command.undo();
		expect(clip.keyframes).toHaveLength(2);
	});
});

describe('mosaic commands', () => {
	const region: MosaicRegion = {
		id: 'm1', x: 10, y: 10, width: 20, height: 20,
		mode: 'pixelate', strength: 50, startTime: null, endTime: null,
	};

	it('adds, updates and removes', () => {
		new AddMosaicCommand(timeline, 'clip-1', region).execute();
		expect(clip.mosaics).toHaveLength(1);

		new UpdateMosaicCommand(timeline, 'clip-1', 'm1', { strength: 90, mode: 'blur' }).execute();
		expect(clip.mosaics[0]).toMatchObject({ strength: 90, mode: 'blur' });

		new RemoveMosaicCommand(timeline, 'clip-1', 'm1').execute();
		expect(clip.mosaics).toEqual([]);
	});

	it('undoes an update without touching the others', () => {
		new AddMosaicCommand(timeline, 'clip-1', region).execute();
		new AddMosaicCommand(timeline, 'clip-1', { ...region, id: 'm2', x: 60 }).execute();

		const command = new UpdateMosaicCommand(timeline, 'clip-1', 'm1', { strength: 5 });
		command.execute();
		command.undo();

		expect(clip.mosaics).toHaveLength(2);
		expect(clip.mosaics[0].strength).toBe(50);
		expect(clip.mosaics[1].x).toBe(60);
	});
});

describe('SetSpeedCurveCommand', () => {
	const curve: SpeedCurve = {
		enabled: true,
		preservePitch: true,
		points: [
			{ id: 'a', time: 0, speed: 1 },
			{ id: 'b', time: 2, speed: 3 },
		],
	};

	it('sets and undoes to null', () => {
		const command = new SetSpeedCurveCommand(timeline, 'clip-1', curve);
		command.execute();
		expect(clip.speedCurve?.points).toHaveLength(2);
		command.undo();
		// Undo must restore "no curve", which is a legitimate null.
		expect(clip.speedCurve).toBeNull();
	});

	it('undoes back to a previous curve', () => {
		new SetSpeedCurveCommand(timeline, 'clip-1', curve).execute();
		const command = new SetSpeedCurveCommand(timeline, 'clip-1', {
			...curve,
			points: [{ id: 'c', time: 0, speed: 0.5 }],
		});
		command.execute();
		command.undo();
		expect(clip.speedCurve?.points).toHaveLength(2);
	});

	it('does not alias the caller’s curve object', () => {
		const source: SpeedCurve = { ...curve, points: [...curve.points] };
		new SetSpeedCurveCommand(timeline, 'clip-1', source).execute();
		source.points[0].speed = 99;
		expect(clip.speedCurve!.points[0].speed).toBe(1);
	});
});
