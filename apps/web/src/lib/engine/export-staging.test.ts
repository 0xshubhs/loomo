import { describe, it, expect } from 'vitest';
import {
	exportTimeline,
	clipInputArgs,
	graphInputArgs,
	silentInputArgs,
	hasStillClips,
	getExt,
	type ExportResult,
} from './export-pipeline.js';
import type { FFmpegEngine, OperationCallback } from './ffmpeg-engine.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, Track } from '$lib/types/timeline.js';
import type { ExportConfig } from '$lib/types/export.js';

/**
 * How the export gets its input bytes.
 *
 * Two bugs shipped here at once. The pipeline enforced ffmpeg.wasm's ~300MB
 * heap limit against every engine, so the desktop refused a 474MB source it
 * could have handled — the export died before it could ask where to save, and
 * the render simply vanished. And even under the limit it called
 * `file.arrayBuffer()`, materialising the whole source in webview memory,
 * despite import having already streamed that exact file to disk.
 */

const CONFIG: ExportConfig = {
	format: 'mp4',
	videoCodec: 'libx264',
	audioCodec: 'aac',
	resolution: '1080p',
	fps: 30,
	videoBitrate: 5000,
	audioBitrate: 192,
	quality: 23,
};

/** Records what the pipeline asked of the engine, and runs nothing. */
class FakeEngine implements FFmpegEngine {
	ready = true;
	busy = false;
	currentOperation: string | null = null;
	initProgress = 'Ready';

	readonly writes: { path: string; bytes: number }[] = [];
	readonly deletes: string[] = [];
	readonly execArgs: string[][] = [];

	/**
	 * Present only when the engine has a persistent store, matching the
	 * optional method on the interface. Assigned in the constructor body:
	 * a class-field initialiser runs before parameter properties exist.
	 */
	fileExists?: (path: string) => Promise<boolean>;

	constructor(
		readonly maxInputBytes: number | null,
		readonly persistentStore: boolean,
		/** Virtual names already holding bytes, as import would have left them. */
		staged: Set<string> | null = null
	) {
		if (staged) this.fileExists = async (path: string) => staged.has(path);
	}

	async initialize(): Promise<void> {}

	async exec(args: string[], callbacks: OperationCallback = {}): Promise<number> {
		this.execArgs.push(args);
		callbacks.onProgress?.(1);
		return 0;
	}

	async writeFile(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		this.writes.push({ path, bytes: data.byteLength });
	}

	async readFile(): Promise<ArrayBuffer> {
		return new Uint8Array([0, 0, 0, 0]).buffer;
	}

	async fileSize(): Promise<number> {
		return 1024;
	}

	async deleteFile(path: string): Promise<void> {
		this.deletes.push(path);
	}

	terminate(): void {}
}

/**
 * A File whose bytes are never actually allocated.
 *
 * Reading a 474MB File in a test would reproduce the very memory blow-up under
 * examination, so `arrayBuffer()` reports the size and hands back nothing. Any
 * code path that truly needs the bytes still gets counted by `writes`.
 */
function hugeFile(sizeBytes: number, name = 'source.mp4'): File {
	const file = new File([new Uint8Array(8)], name, { type: 'video/mp4' });
	Object.defineProperty(file, 'size', { value: sizeBytes });
	Object.defineProperty(file, 'arrayBuffer', {
		value: async () => new ArrayBuffer(0),
	});
	return file;
}

function track(clips: Clip[]): Track[] {
	return [
		{
			id: 'track-1',
			name: 'Video',
			type: 'video',
			clips,
			muted: false,
			locked: false,
			visible: true,
			height: 80,
			volume: 1,
		},
	];
}

function clip(over: Partial<Clip> = {}): Clip {
	return createClip({
		id: 'clip-1',
		name: 'source.mp4',
		type: 'video',
		assetId: 'asset-1',
		trackId: 'track-1',
		timelineStart: 0,
		duration: 5,
		...over,
	});
}

function run(
	engine: FFmpegEngine,
	asset: { file: File; name: string; scratchName?: string; width?: number; height?: number },
	clips: Clip[] = [clip()]
): Promise<ExportResult> {
	return exportTimeline(
		engine,
		track(clips),
		[],
		[],
		CONFIG,
		() => {},
		() => asset
	);
}

const HALF_GIG = 474 * 1024 * 1024;
const WASM_LIMIT = 300 * 1024 * 1024;

describe('input size limits', () => {
	it('lets a native engine export a source far past the wasm heap limit', async () => {
		const engine = new FakeEngine(null, true);
		await expect(
			run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4' })
		).resolves.toMatchObject({ scratchName: expect.any(String) });
	});

	it('still rejects an oversized source on an engine that has a limit', async () => {
		const engine = new FakeEngine(WASM_LIMIT, false);
		await expect(
			run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4' })
		).rejects.toThrow(/too large \(474MB\)/);
	});

	it('names the real ceiling and the way around it', async () => {
		const engine = new FakeEngine(WASM_LIMIT, false);
		const error = await run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4' }).catch((e) => e);
		expect(error.message).toContain('300MB');
		expect(error.message).toContain('desktop app');
	});

	it('accepts a source inside the limit, and hands back bytes', async () => {
		// Nothing persists in a wasm worker, so the web build has to take the
		// output as a Blob however large it is.
		const engine = new FakeEngine(WASM_LIMIT, false);
		await expect(
			run(engine, { file: hugeFile(10 * 1024 * 1024), name: 'source.mp4' })
		).resolves.toMatchObject({ blob: expect.any(Blob), scratchName: null });
	});
});

describe('reusing files staged at import', () => {
	it('does not copy the source again when it is already on disk', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		await run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4', scratchName: 'media_abc.mp4' });

		expect(engine.writes).toEqual([]);
	});

	it('feeds ffmpeg the staged filename', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		await run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4', scratchName: 'media_abc.mp4' });

		expect(engine.execArgs.flat()).toContain('media_abc.mp4');
	});

	it('leaves the staged file in place — the preview is still using it', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		await run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4', scratchName: 'media_abc.mp4' });

		expect(engine.deletes).not.toContain('media_abc.mp4');
	});

	it('writes the file when staging has been cleared out from under it', async () => {
		// The scratch directory is emptied on launch, so a name recorded at
		// import is not proof the bytes are still there.
		const engine = new FakeEngine(null, true, new Set());
		await run(engine, { file: hugeFile(4 * 1024 * 1024), name: 'source.mp4', scratchName: 'media_gone.mp4' });

		expect(engine.writes.map((w) => w.path)).toEqual(['src_0.mp4']);
	});

	it('writes the file on an engine with no persistent store at all', async () => {
		const engine = new FakeEngine(WASM_LIMIT, false);
		await run(engine, { file: hugeFile(4 * 1024 * 1024), name: 'source.mp4', scratchName: 'media_abc.mp4' });

		expect(engine.writes.map((w) => w.path)).toEqual(['src_0.mp4']);
	});

	it('skips the size check entirely for a staged file', async () => {
		// A staged source is never read into memory, so the heap limit that
		// motivates the check does not apply to it.
		const engine = new FakeEngine(WASM_LIMIT, true, new Set(['media_abc.mp4']));
		await expect(
			run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4', scratchName: 'media_abc.mp4' })
		).resolves.toMatchObject({ scratchName: expect.any(String) });
	});

	it('cleans up a temporary input it created', async () => {
		const engine = new FakeEngine(null, true, new Set());
		await run(engine, { file: hugeFile(4 * 1024 * 1024), name: 'source.mp4' });

		expect(engine.deletes).toContain('src_0.mp4');
	});
});

describe('handing back the finished render', () => {
	it('leaves the output on disk instead of reading it into memory', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		const result = await run(engine, {
			file: hugeFile(HALF_GIG),
			name: 'source.mp4',
			scratchName: 'media_abc.mp4',
		});

		expect(result.blob).toBeNull();
		expect(result.scratchName).toBeTruthy();
	});

	it('keeps the output file until the caller has saved it', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		const result = await run(engine, {
			file: hugeFile(HALF_GIG),
			name: 'source.mp4',
			scratchName: 'media_abc.mp4',
		});

		expect(engine.deletes).not.toContain(result.scratchName);
	});

	it('still reports a size for the progress readout', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		const result = await run(engine, {
			file: hugeFile(HALF_GIG),
			name: 'source.mp4',
			scratchName: 'media_abc.mp4',
		});

		expect(result.size).toBeGreaterThan(0);
	});
});

describe('multi-clip exports', () => {
	const clips = [
		clip({ id: 'clip-1', timelineStart: 0, duration: 5 }),
		clip({ id: 'clip-2', timelineStart: 5, duration: 5 }),
	];

	it('reuses one staged file across every clip that shares the asset', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_abc.mp4']));
		await run(engine, { file: hugeFile(HALF_GIG), name: 'source.mp4', scratchName: 'media_abc.mp4' }, clips);

		expect(engine.writes.filter((w) => w.path.startsWith('src_'))).toEqual([]);
		expect(engine.deletes).not.toContain('media_abc.mp4');
	});
});

describe('choosing a strategy for a reopened project', () => {
	/**
	 * A reopened project holds an empty `File` — its bytes are on disk, and
	 * materialising them to read a width would defeat the point of keeping
	 * them there. The pipeline used to probe that placeholder, get nothing,
	 * and re-encode every export as a result: correct output, minutes of work
	 * for a copy that should have been instant.
	 */
	function placeholder(): File {
		return new File([], 'source.mp4', { type: 'video/mp4' });
	}

	function copied(engine: FakeEngine): boolean {
		return engine.execArgs.some((args) => args.includes('copy'));
	}

	it('stream-copies when the known dimensions already match the target', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_a1.mp4']));

		await run(engine, {
			file: placeholder(),
			name: 'source.mp4',
			scratchName: 'media_a1.mp4',
			width: 1920,
			height: 1080,
		});

		expect(copied(engine)).toBe(true);
	});

	it('re-encodes when the known dimensions differ from the target', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_a1.mp4']));

		await run(engine, {
			file: placeholder(),
			name: 'source.mp4',
			scratchName: 'media_a1.mp4',
			width: 3840,
			height: 2160,
		});

		expect(copied(engine)).toBe(false);
	});

	it('still re-encodes when nothing is known about the source', async () => {
		// Unknown must not be read as "already matches": stream-copying on a
		// failed probe hands back the source resolution instead of the one
		// that was asked for.
		const engine = new FakeEngine(null, true, new Set(['media_a1.mp4']));

		await run(engine, { file: placeholder(), name: 'source.mp4', scratchName: 'media_a1.mp4' });

		expect(copied(engine)).toBe(false);
	});

	it('treats zero dimensions as unknown rather than as a match', async () => {
		const engine = new FakeEngine(null, true, new Set(['media_a1.mp4']));

		await run(engine, {
			file: placeholder(),
			name: 'source.mp4',
			scratchName: 'media_a1.mp4',
			width: 0,
			height: 0,
		});

		expect(copied(engine)).toBe(false);
	});
});

describe('input flags for a still', () => {
	/**
	 * `-i photo.png -t 10` yields one frame: `-t` shortens an input, it cannot
	 * extend one. A still has to be looped at a frame rate and then bounded.
	 */
	function still(duration = 10): Clip {
		return clip({ id: 'img', name: 'card.png', type: 'image', assetId: 'asset-img', duration });
	}

	it('loops an image for the length of the clip', () => {
		expect(clipInputArgs(still(10), 'card.png', 30)).toEqual([
			'-loop', '1', '-framerate', '30', '-t', '10', '-i', 'card.png',
		]);
	});

	it('takes the frame rate from the export config', () => {
		expect(clipInputArgs(still(), 'card.png', 60)).toContain('60');
	});

	it('leaves a video clip seeking and trimming as before', () => {
		const trimmed = clip({ sourceStart: 2, duration: 5 });

		expect(clipInputArgs(trimmed, 'source.mp4', 30)).toEqual([
			'-ss', '2', '-i', 'source.mp4', '-t', '5',
		]);
	});

	it('does not seek a video clip that starts at zero', () => {
		expect(clipInputArgs(clip({ duration: 5 }), 'source.mp4', 30)).toEqual([
			'-i', 'source.mp4', '-t', '5',
		]);
	});

	it('still bounds a looped image in the graph strategy', () => {
		// `-loop 1` with no `-t` is an input that never ends.
		expect(graphInputArgs(still(4), 'card.png', 24)).toEqual([
			'-loop', '1', '-framerate', '24', '-t', '4', '-i', 'card.png',
		]);
	});

	it('leaves trimming to the graph for a video clip', () => {
		const trimmed = clip({ sourceStart: 2, duration: 5 });

		expect(graphInputArgs(trimmed, 'source.mp4', 30)).toEqual(['-i', 'source.mp4']);
	});

	it('manufactures silence the length of the clip', () => {
		// An image input has no audio stream, so [n:a] is a graph error rather
		// than silence, and concat with a clip that has audio fails.
		expect(silentInputArgs(3)).toEqual([
			'-f', 'lavfi', '-t', '3', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
		]);
	});

	it('reports whether a timeline holds a still, which rules out stream copy', () => {
		expect(hasStillClips([clip({})])).toBe(false);
		expect(hasStillClips([clip({}), still()])).toBe(true);
	});
});

describe('naming working files from a user filename', () => {
	/**
	 * These become paths handed to a process. Real filenames are not tame:
	 * spaces, quotes, percent escapes, and the odd newline all turn up.
	 */
	it('keeps an ordinary extension', () => {
		expect(getExt('holiday.mp4')).toBe('mp4');
		expect(getExt('holiday.MKV')).toBe('mkv');
	});

	it('strips anything that is not a letter or digit', () => {
		expect(getExt('clip.m p4')).toBe('mp4');
		expect(getExt("clip.mp'4")).toBe('mp4');
		expect(getExt('clip.mp4\n')).toBe('mp4');
	});

	it('handles a name with several dots', () => {
		expect(getExt('Members Only S2 Episode 2.Sourav.mp4')).toBe('mp4');
	});

	it('handles a percent-encoded name', () => {
		expect(getExt('Members%20Only%20S2.mp4')).toBe('mp4');
	});

	it('falls back for a file with no extension', () => {
		expect(getExt('recording')).toBe('mp4');
	});

	it('falls back when the extension is only punctuation', () => {
		// Otherwise the working file is named `src_0.` — or worse, `src_0.-f`,
		// which ffmpeg reads as an option.
		expect(getExt('clip.--')).toBe('mp4');
	});

	it('caps a preposterous extension', () => {
		expect(getExt(`clip.${'x'.repeat(200)}`)).toBe('x'.repeat(8));
	});
});
