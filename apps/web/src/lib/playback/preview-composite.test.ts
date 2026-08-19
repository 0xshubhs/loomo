import { describe, it, expect } from 'vitest';
import { visibleLayers, baseLayer, overlayLayers, layerRect } from './preview-composite.js';
import { createClip, DEFAULT_CLIP_POSITION } from '$lib/types/timeline.js';
import type { Clip, Track } from '$lib/types/timeline.js';

/**
 * The preview drew one track while the export composited all of them. An image
 * held over the opening seconds previewed as nothing and exported correctly —
 * the worst way round, because the editor cannot see what they are making.
 */

function track(over: Partial<Track> & { id: string; clips: Clip[] }): Track {
	return {
		name: 'Video',
		type: 'video',
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
		name: 'a.mp4',
		type: 'video',
		assetId: 'a1',
		timelineStart: 0,
		duration: 10,
		...over,
	});
}

describe('what is on screen', () => {
	it('finds the clip under the playhead', () => {
		const tracks = [track({ id: 't1', clips: [clip({ id: 'c1', trackId: 't1' })] })];

		expect(visibleLayers(tracks, 5).map((l) => l.clip.id)).toEqual(['c1']);
	});

	it('finds nothing on an empty frame', () => {
		const tracks = [track({ id: 't1', clips: [clip({ id: 'c1', trackId: 't1', duration: 2 })] })];

		expect(visibleLayers(tracks, 5)).toEqual([]);
	});

	it('excludes a clip that ends exactly at the playhead', () => {
		// Half-open, so the first frame of the next clip is not also the last
		// frame of this one.
		const tracks = [track({ id: 't1', clips: [clip({ id: 'c1', trackId: 't1', duration: 5 })] })];

		expect(visibleLayers(tracks, 5)).toEqual([]);
	});

	it('returns every video track that has something at that time', () => {
		// This is the case the preview used to miss entirely.
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'base', trackId: 't1' })] }),
			track({ id: 't2', clips: [clip({ id: 'logo', trackId: 't2', duration: 3 })] }),
		];

		expect(visibleLayers(tracks, 1).map((l) => l.clip.id)).toEqual(['base', 'logo']);
	});

	it('stacks later tracks over earlier ones, as the export does', () => {
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'base', trackId: 't1' })] }),
			track({ id: 't2', clips: [clip({ id: 'over', trackId: 't2' })] }),
		];
		const layers = visibleLayers(tracks, 1);

		expect(baseLayer(layers)?.clip.id).toBe('base');
		expect(overlayLayers(layers).map((l) => l.clip.id)).toEqual(['over']);
	});

	it('skips a hidden track', () => {
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'base', trackId: 't1' })] }),
			track({ id: 't2', visible: false, clips: [clip({ id: 'hidden', trackId: 't2' })] }),
		];

		expect(visibleLayers(tracks, 1).map((l) => l.clip.id)).toEqual(['base']);
	});

	it('skips audio tracks, which are not pictures', () => {
		const tracks = [
			track({ id: 't1', clips: [clip({ id: 'base', trackId: 't1' })] }),
			track({ id: 't2', type: 'audio', clips: [clip({ id: 'music', trackId: 't2', type: 'audio' })] }),
		];

		expect(visibleLayers(tracks, 1).map((l) => l.clip.id)).toEqual(['base']);
	});

	it('reads opacity as 0-1, not as a percentage', () => {
		// Reading it the other way is what made every composited overlay
		// invisible in the export: colorchannelmixer=aa=0.010.
		const tracks = [track({ id: 't1', clips: [clip({ id: 'c1', trackId: 't1', opacity: 0.5 })] })];

		expect(visibleLayers(tracks, 1)[0].opacity).toBe(0.5);
	});

	it('treats a clip with no opacity set as fully opaque', () => {
		const tracks = [track({ id: 't1', clips: [clip({ id: 'c1', trackId: 't1' })] })];

		expect(visibleLayers(tracks, 1)[0].opacity).toBe(1);
	});

	it('makes the first track holding a clip the base, not the first track', () => {
		// The export picks the first video track that has clips; an empty
		// track above it must not become the base.
		const tracks = [
			track({ id: 't0', clips: [] }),
			track({ id: 't1', clips: [clip({ id: 'base', trackId: 't1' })] }),
		];

		expect(baseLayer(visibleLayers(tracks, 1))?.clip.id).toBe('base');
	});
});

describe('where a layer draws', () => {
	const full = (over: Partial<Clip> = {}) => clip({ id: 'c1', trackId: 't1', ...over });

	it('fills the frame when no position is set', () => {
		expect(layerRect(full(), 1920, 1080, 1920, 1080)).toEqual({
			x: 0, y: 0, width: 1920, height: 1080,
		});
	});

	it('fits a differently shaped source inside the frame and centres it', () => {
		// ffmpeg scales with force_original_aspect_ratio=decrease and centres
		// the result. Stretching to the box instead would preview a square
		// logo as wide.
		const rect = layerRect(full(), 1000, 1000, 200, 100);

		expect(rect).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
	});

	it('honours a picture-in-picture position', () => {
		const positioned = full({
			position: { ...DEFAULT_CLIP_POSITION, x: 50, y: 50, width: 25, height: 25 },
		});

		const rect = layerRect(positioned, 1000, 1000, 100, 100);

		expect(rect).toEqual({ x: 500, y: 500, width: 250, height: 250 });
	});

	it('centres inside its box when the source does not match the box shape', () => {
		const positioned = full({
			position: { ...DEFAULT_CLIP_POSITION, x: 0, y: 0, width: 50, height: 50 },
		});

		const rect = layerRect(positioned, 1000, 1000, 100, 50);

		expect(rect).toEqual({ x: 0, y: 125, width: 500, height: 250 });
	});

	it('falls back to the whole box when the source size is unknown', () => {
		expect(layerRect(full(), 800, 600, 0, 0)).toEqual({
			x: 0, y: 0, width: 800, height: 600,
		});
	});
});
