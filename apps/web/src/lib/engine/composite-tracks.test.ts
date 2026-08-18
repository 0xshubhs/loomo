import { describe, it, expect } from 'vitest';
import { planComposite, buildCompositeFilter, inputArgsFor } from './composite-tracks.js';
import type { CompositePlan, CompositeSource } from './composite-tracks.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, Track } from '$lib/types/timeline.js';

/**
 * Compositing the tracks the base render never covered.
 *
 * The export read a single track and dropped everything else, so an image held
 * over the opening seconds, a logo on a second video track, or a music bed all
 * showed in the preview and were missing from the exported file.
 */

function track(over: Partial<Track> & { id: string; type: 'video' | 'audio' }): Track {
	return {
		name: over.id,
		clips: [],
		muted: false,
		locked: false,
		visible: true,
		height: 80,
		volume: 1,
		...over,
	};
}

function clip(over: Partial<Clip> & { id: string; trackId: string }): Clip {
	return createClip({
		name: 'clip.mp4',
		type: 'video',
		assetId: `asset-${over.id}`,
		timelineStart: 0,
		duration: 5,
		...over,
	});
}

function source(over: Partial<CompositeSource> & { clip: Clip }): CompositeSource {
	return { path: `${over.clip.id}.mp4`, isStill: false, ...over };
}

const OPTIONS = { width: 1920, height: 1080, fps: 30, baseHasAudio: true };

describe('deciding what to composite', () => {
	it('leaves out the track the base render already covered', () => {
		const tracks = [
			track({ id: 'base', type: 'video', clips: [clip({ id: 'a', trackId: 'base' })] }),
			track({ id: 'over', type: 'video', clips: [clip({ id: 'b', trackId: 'over' })] }),
		];

		const plan = planComposite(tracks, 'base');

		expect(plan.overlayClips.map((c) => c.id)).toEqual(['b']);
	});

	it('picks up audio tracks, which were dropped entirely', () => {
		const tracks = [
			track({ id: 'base', type: 'video', clips: [clip({ id: 'a', trackId: 'base' })] }),
			track({ id: 'music', type: 'audio', clips: [clip({ id: 'm', trackId: 'music', type: 'audio' })] }),
		];

		const plan = planComposite(tracks, 'base');

		expect(plan.audioClips.map((c) => c.id)).toEqual(['m']);
	});

	it('skips a hidden video track', () => {
		const tracks = [
			track({ id: 'base', type: 'video' }),
			track({ id: 'over', type: 'video', visible: false, clips: [clip({ id: 'b', trackId: 'over' })] }),
		];

		expect(planComposite(tracks, 'base').overlayClips).toEqual([]);
	});

	it('skips a muted audio track', () => {
		const tracks = [
			track({ id: 'base', type: 'video' }),
			track({ id: 'music', type: 'audio', muted: true, clips: [clip({ id: 'm', trackId: 'music' })] }),
		];

		expect(planComposite(tracks, 'base').audioClips).toEqual([]);
	});

	it('folds the track fader into the clip volume', () => {
		const tracks = [
			track({ id: 'base', type: 'video' }),
			track({
				id: 'music',
				type: 'audio',
				volume: 0.5,
				clips: [clip({ id: 'm', trackId: 'music', volume: 0.8 })],
			}),
		];

		expect(planComposite(tracks, 'base').audioClips[0].volume).toBeCloseTo(0.4);
	});

	it('orders overlays by when they start', () => {
		const tracks = [
			track({ id: 'base', type: 'video' }),
			track({
				id: 'over',
				type: 'video',
				clips: [
					clip({ id: 'late', trackId: 'over', timelineStart: 10 }),
					clip({ id: 'early', trackId: 'over', timelineStart: 2 }),
				],
			}),
		];

		expect(planComposite(tracks, 'base').overlayClips.map((c) => c.id)).toEqual(['early', 'late']);
	});
});

describe('placing an overlay in time', () => {
	it('shifts it to where it sits on the timeline', () => {
		// The whole point of a track: an image dropped at ten seconds appears at
		// ten seconds, not at the start.
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't', timelineStart: 10, duration: 5 }) })],
			audio: [],
		};

		const { filter } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('setpts=PTS-STARTPTS+10.000/TB');
	});

	it('shows it only for its own span', () => {
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't', timelineStart: 10, duration: 5 }) })],
			audio: [],
		};

		const { filter } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain("enable='between(t,10.000,15.000)'");
	});

	it('draws it over the base rather than replacing the stream', () => {
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't' }) })],
			audio: [],
		};

		const { filter, videoLabel } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('[0:v][ov0]overlay=');
		expect(videoLabel).toBe('vout');
	});

	it('stacks several overlays in order, each onto the previous result', () => {
		const plan: CompositePlan = {
			overlays: [
				source({ clip: clip({ id: 'one', trackId: 't' }) }),
				source({ clip: clip({ id: 'two', trackId: 't' }) }),
			],
			audio: [],
		};

		const { filter } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('[bg0][ov1]overlay=');
	});

	it('applies clip opacity', () => {
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't', opacity: 0.4 }) })],
			audio: [],
		};

		const { filter } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('colorchannelmixer=aa=0.400');
	});

	it('reads opacity on its own 0-1 scale, not as a percentage', () => {
		// ClipFilters.opacity runs 0-100 in the same codebase. Reading this one
		// the same way drew every overlay at 1% alpha — indistinguishable from
		// the compositing never happening.
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't' }) })],
			audio: [],
		};

		expect(clip({ id: 'x', trackId: 't' }).opacity).toBe(1);
		expect(buildCompositeFilter(plan, OPTIONS).filter).not.toContain('colorchannelmixer');
	});

	it('leaves a fully opaque overlay alone', () => {
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't', opacity: 1 }) })],
			audio: [],
		};

		expect(buildCompositeFilter(plan, OPTIONS).filter).not.toContain('colorchannelmixer');
	});

	it('honours a picture-in-picture position', () => {
		const positioned = clip({ id: 'pip', trackId: 't' });
		positioned.position = { x: 50, y: 25, width: 25, height: 25, zIndex: 1 };
		const plan: CompositePlan = { overlays: [source({ clip: positioned })], audio: [] };

		const { filter } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('scale=480:270');
		expect(filter).toContain('overlay=960:270');
	});

	it('centres a full-frame overlay', () => {
		const plan: CompositePlan = {
			overlays: [source({ clip: clip({ id: 'img', trackId: 't' }) })],
			audio: [],
		};

		expect(buildCompositeFilter(plan, OPTIONS).filter).toContain('overlay=(W-w)/2:(H-h)/2');
	});
});

describe('mixing in audio tracks', () => {
	it('delays a clip to its timeline position, on both channels', () => {
		const plan: CompositePlan = {
			overlays: [],
			audio: [source({ clip: clip({ id: 'm', trackId: 'a', timelineStart: 3 }) })],
		};

		const { filter } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('adelay=3000|3000');
	});

	it('does not delay a clip that starts at zero', () => {
		const plan: CompositePlan = {
			overlays: [],
			audio: [source({ clip: clip({ id: 'm', trackId: 'a', timelineStart: 0 }) })],
		};

		expect(buildCompositeFilter(plan, OPTIONS).filter).not.toContain('adelay');
	});

	it('mixes against the base audio without attenuating it', () => {
		// amix defaults to normalize=1, which divides every input by the input
		// count — adding one music track would halve the original sound.
		const plan: CompositePlan = {
			overlays: [],
			audio: [source({ clip: clip({ id: 'm', trackId: 'a' }) })],
		};

		const { filter, audioLabel } = buildCompositeFilter(plan, OPTIONS);

		expect(filter).toContain('amix=inputs=2:normalize=0');
		expect(audioLabel).toBe('aout');
	});

	it('skips the mixer when the base render has no sound of its own', () => {
		const plan: CompositePlan = {
			overlays: [],
			audio: [source({ clip: clip({ id: 'm', trackId: 'a' }) })],
		};

		const { filter, audioLabel } = buildCompositeFilter(plan, { ...OPTIONS, baseHasAudio: false });

		expect(filter).not.toContain('amix');
		expect(audioLabel).toBe('au0');
	});

	it('maps the base audio straight through when nothing was added', () => {
		const plan: CompositePlan = { overlays: [], audio: [] };

		expect(buildCompositeFilter(plan, OPTIONS).audioLabel).toBe('0:a');
	});

	it('silences a muted clip rather than dropping it from the graph', () => {
		const plan: CompositePlan = {
			overlays: [],
			audio: [source({ clip: clip({ id: 'm', trackId: 'a', muted: true }) })],
		};

		expect(buildCompositeFilter(plan, OPTIONS).filter).toContain('volume=0');
	});
});

describe('opening each source', () => {
	it('loops a still, which otherwise contributes one frame', () => {
		const still = source({ clip: clip({ id: 'img', trackId: 't', type: 'image', duration: 8 }), isStill: true });

		expect(inputArgsFor(still, 30)).toEqual([
			'-loop', '1', '-framerate', '30', '-t', '8', '-i', 'img.mp4',
		]);
	});

	it('trims a video to the part the timeline uses', () => {
		const video = source({ clip: clip({ id: 'v', trackId: 't', sourceStart: 4, duration: 6 }) });

		expect(inputArgsFor(video, 30)).toEqual(['-ss', '4', '-t', '6', '-i', 'v.mp4']);
	});

	it('omits the seek when the clip starts at the beginning', () => {
		const video = source({ clip: clip({ id: 'v', trackId: 't', sourceStart: 0, duration: 6 }) });

		expect(inputArgsFor(video, 30)).toEqual(['-t', '6', '-i', 'v.mp4']);
	});
});
