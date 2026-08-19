import { describe, it, expect } from 'vitest';
import {
	buildDocument,
	parseDocument,
	documentDuration,
	storedFilename,
	encodeWaveform,
	decodeWaveform,
	ProjectFormatError,
	PROJECT_FORMAT_VERSION,
	type EditorSnapshot,
} from './document.js';
import { createClip } from '$lib/types/timeline.js';
import type { Track } from '$lib/types/timeline.js';
import type { MediaAsset } from '$lib/types/media.js';

/**
 * The saved project format.
 *
 * A project has to survive being closed, so this is the one place where getting
 * it wrong loses the user's work rather than just looking wrong.
 */

function asset(over: Partial<MediaAsset> & { id: string }): MediaAsset {
	return {
		name: 'clip.mp4',
		file: new File([], 'clip.mp4'),
		blobUrl: '',
		type: 'video',
		metadata: {
			duration: 10,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'h264',
			audioCodec: 'aac',
			bitrate: 5_000_000,
			fileSize: 1024,
			format: 'video/mp4',
		},
		thumbnails: [],
		waveform: null,
		addedAt: 0,
		...over,
	};
}

function track(clips: ReturnType<typeof createClip>[]): Track {
	return {
		id: 'track-1',
		name: 'Video',
		type: 'video',
		clips,
		muted: false,
		locked: false,
		visible: true,
		height: 80,
		volume: 1,
	};
}

function snapshot(over: Partial<EditorSnapshot> = {}): EditorSnapshot {
	return {
		name: 'My project',
		assets: [],
		tracks: [],
		transitions: [],
		textOverlays: [],
		shapeOverlays: [],
		annotations: [],
		markers: [],
		captions: null,
		aspectRatio: '16:9',
		...over,
	};
}

describe('writing a project', () => {
	it('keeps the timeline', () => {
		const clip = createClip({
			id: 'clip-1',
			name: 'clip.mp4',
			type: 'video',
			assetId: 'a1',
			trackId: 'track-1',
			timelineStart: 0,
			duration: 5,
		});

		const doc = buildDocument(snapshot({ tracks: [track([clip])] }), new Map(), 1000);

		expect(doc.tracks[0].clips[0].id).toBe('clip-1');
	});

	it('records the format version, so a future build knows what it is reading', () => {
		expect(buildDocument(snapshot(), new Map(), 1000).version).toBe(PROJECT_FORMAT_VERSION);
	});

	it('names each asset by the file stored inside the project', () => {
		const stored = new Map([['a1', 'a1.mp4']]);

		const doc = buildDocument(snapshot({ assets: [asset({ id: 'a1' })] }), stored, 1000);

		expect(doc.assets[0].file).toBe('a1.mp4');
	});

	it('leaves out an asset whose media could not be stored', () => {
		// Better a project that opens without one clip than a document naming a
		// file that was never written.
		const doc = buildDocument(snapshot({ assets: [asset({ id: 'a1' })] }), new Map(), 1000);

		expect(doc.assets).toEqual([]);
	});

	it('keeps data-url thumbnails but not blob urls', () => {
		// A blob url is meaningless in the next session.
		const stored = new Map([['a1', 'a1.mp4']]);
		const withThumbs = asset({
			id: 'a1',
			thumbnails: ['data:image/jpeg;base64,abc', 'blob:tauri://localhost/1234'],
		});

		const doc = buildDocument(snapshot({ assets: [withThumbs] }), stored, 1000);

		expect(doc.assets[0].thumbnails).toEqual(['data:image/jpeg;base64,abc']);
	});
});

describe('waveforms', () => {
	it('survives a save and reopen', () => {
		// Regenerating one means decoding the whole file again, so a reopened
		// project would show flat grey bars until every clip had been read
		// twice.
		const samples = new Float32Array([0, 0.5, -0.25, 1]);

		expect(Array.from(decodeWaveform(encodeWaveform(samples))!)).toEqual([0, 0.5, -0.25, 1]);
	});

	it('keeps the samples exact rather than rounding them', () => {
		const samples = new Float32Array([0.123456789]);

		expect(decodeWaveform(encodeWaveform(samples))![0]).toBe(samples[0]);
	});

	it('handles a full-length waveform', () => {
		const samples = new Float32Array(1000).map((_, i) => Math.sin(i));

		expect(decodeWaveform(encodeWaveform(samples))!.length).toBe(1000);
	});

	it('stores nothing for an asset with no audio', () => {
		expect(encodeWaveform(null)).toBeNull();
		expect(encodeWaveform(new Float32Array(0))).toBeNull();
	});

	it('drops a damaged waveform instead of failing the open', () => {
		// A waveform is decoration. Losing it must not cost the project.
		expect(decodeWaveform('not base64 @@@')).toBeNull();
		expect(decodeWaveform('AAA=')).toBeNull(); // not a whole number of floats
		expect(decodeWaveform(undefined)).toBeNull();
	});

	it('is written into the document', () => {
		const stored = new Map([['a1', 'a1.mp4']]);
		const withWave = asset({ id: 'a1', waveform: new Float32Array([0.5]) });

		const doc = buildDocument(snapshot({ assets: [withWave] }), stored, 1000);

		expect(decodeWaveform(doc.assets[0].waveform)![0]).toBeCloseTo(0.5);
	});
});

describe('naming stored media', () => {
	it('uses the asset id, not the display name', () => {
		// Two clips can both be called "video.mp4".
		expect(storedFilename({ id: 'a1', name: 'video.mp4' })).toBe('a1.mp4');
	});

	it('gives two identically named files different storage names', () => {
		const first = storedFilename({ id: 'a1', name: 'video.mp4' });
		const second = storedFilename({ id: 'a2', name: 'video.mp4' });

		expect(first).not.toBe(second);
	});

	it('strips anything odd out of the extension', () => {
		expect(storedFilename({ id: 'a1', name: 'clip.MP4' })).toBe('a1.mp4');
		expect(storedFilename({ id: 'a1', name: 'clip.m p4/' })).toBe('a1.mp4');
	});

	it('copes with a file that has no extension', () => {
		expect(storedFilename({ id: 'a1', name: 'recording' })).toBe('a1.bin');
	});
});

describe('reading a project back', () => {
	it('round-trips what was written', () => {
		const clip = createClip({
			id: 'clip-1',
			name: 'clip.mp4',
			type: 'video',
			assetId: 'a1',
			trackId: 'track-1',
			timelineStart: 2,
			duration: 5,
		});
		const doc = buildDocument(snapshot({ tracks: [track([clip])] }), new Map(), 1234);

		const read = parseDocument(JSON.stringify(doc));

		expect(read.tracks[0].clips[0].timelineStart).toBe(2);
		expect(read.savedAt).toBe(1234);
		expect(read.name).toBe('My project');
	});

	it('refuses a project written by a newer build', () => {
		// Half-reading it would silently drop whatever that format added.
		const future = JSON.stringify({ version: PROJECT_FORMAT_VERSION + 1, tracks: [] });

		expect(() => parseDocument(future)).toThrow(ProjectFormatError);
		expect(() => parseDocument(future)).toThrow(/newer version/i);
	});

	it('refuses a file that is not a project', () => {
		expect(() => parseDocument('{"hello":"world"}')).toThrow(/not a Loomo project/i);
	});

	it('refuses a damaged file rather than opening an empty editor', () => {
		expect(() => parseDocument('{ broken')).toThrow(/damaged/i);
	});

	it('keeps markers', () => {
		const doc = buildDocument(
			snapshot({ markers: [{ id: 'm1', time: 4, label: 'Chorus', color: '#fff' }] }),
			new Map(),
			0
		);

		expect(parseDocument(JSON.stringify(doc)).markers[0].label).toBe('Chorus');
	});

	it('accepts a project saved before markers existed', () => {
		expect(parseDocument(JSON.stringify({ version: 1, tracks: [] })).markers).toEqual([]);
	});

	it('accepts a project saved before waveforms were stored', () => {
		const older = JSON.stringify({
			version: 1,
			tracks: [],
			assets: [{ id: 'a1', name: 'a.mp4', type: 'video', file: 'a1.mp4', metadata: {}, thumbnails: [] }],
		});

		expect(decodeWaveform(parseDocument(older).assets[0].waveform)).toBeNull();
	});

	it('accepts a project saved before drawings existed', () => {
		// Missing optional collections are an older project, not a broken one.
		const older = JSON.stringify({ version: 1, name: 'Old', tracks: [] });

		expect(parseDocument(older).annotations).toEqual([]);
	});
});

describe('project duration', () => {
	it('is the end of the last clip, not the sum of them', () => {
		const first = createClip({
			id: 'c1', name: 'a.mp4', type: 'video', assetId: 'a1',
			trackId: 'track-1', timelineStart: 0, duration: 5,
		});
		const second = createClip({
			id: 'c2', name: 'b.mp4', type: 'video', assetId: 'a1',
			trackId: 'track-1', timelineStart: 10, duration: 5,
		});

		const doc = buildDocument(snapshot({ tracks: [track([first, second])] }), new Map(), 0);

		expect(documentDuration(doc)).toBe(15);
	});

	it('is zero for an empty project', () => {
		expect(documentDuration(buildDocument(snapshot(), new Map(), 0))).toBe(0);
	});
});
