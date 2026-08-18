import { describe, it, expect } from 'vitest';
import { exportTimeline } from './export-pipeline.js';
import { BITRATE_FOR_RESOLUTION } from '$lib/types/export.js';
import type { FFmpegEngine, OperationCallback } from './ffmpeg-engine.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, Track } from '$lib/types/timeline.js';
import type { ExportConfig, Resolution } from '$lib/types/export.js';

/**
 * Encoder settings that used to be picked for ffmpeg.wasm's benefit.
 *
 * A 4K export came out at `-preset ultrafast -threads 1 -b:v 5000k`: the
 * preset and thread count exist to keep the wasm heap small, and the bitrate
 * was a single default shared by every resolution. On the native binary none
 * of that applies, and together they produced a 3840x2160 file with roughly a
 * quarter of the detail per pixel of a 1080p one.
 */

function configFor(resolution: Resolution): ExportConfig {
	return {
		format: 'mp4',
		videoCodec: 'libx264',
		audioCodec: 'aac',
		resolution,
		fps: 30,
		videoBitrate: BITRATE_FOR_RESOLUTION[resolution],
		audioBitrate: 192,
		quality: 23,
	};
}

class FakeEngine implements FFmpegEngine {
	ready = true;
	busy = false;
	currentOperation: string | null = null;
	initProgress = 'Ready';
	readonly maxInputBytes = null;
	readonly execArgs: string[][] = [];

	constructor(readonly persistentStore: boolean) {}

	async initialize(): Promise<void> {}

	async exec(args: string[], callbacks: OperationCallback = {}): Promise<number> {
		this.execArgs.push(args);
		callbacks.onProgress?.(1);
		return 0;
	}

	async writeFile(): Promise<void> {}
	async readFile(): Promise<ArrayBuffer> {
		return new Uint8Array([0]).buffer;
	}
	async fileSize(): Promise<number> {
		return 1024;
	}
	async deleteFile(): Promise<void> {}
	terminate(): void {}
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

async function argsFor(engine: FakeEngine, resolution: Resolution): Promise<string[]> {
	const file = new File([new Uint8Array(8)], 'source.mp4', { type: 'video/mp4' });
	await exportTimeline(
		engine,
		track([clip()]),
		[],
		[],
		configFor(resolution),
		() => {},
		() => ({ file, name: 'source.mp4' })
	);
	// The encode is the call carrying the codec; the concat that may follow
	// only stream-copies.
	return engine.execArgs.find((a) => a.includes('-c:v')) ?? [];
}

/** Reads the value that follows a flag, so order changes do not break these. */
function flag(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

describe('encoder settings on the native engine', () => {
	it('does not use the wasm memory-saving preset', async () => {
		const args = await argsFor(new FakeEngine(true), '4k');

		expect(flag(args, '-preset')).not.toBe('ultrafast');
	});

	it('uses every core rather than one', async () => {
		// -threads 1 exists to cap wasm memory; on a real binary it just makes
		// a 4K encode take many times longer.
		const args = await argsFor(new FakeEngine(true), '4k');

		expect(flag(args, '-threads')).toBe('0');
	});
});

describe('encoder settings on the wasm engine', () => {
	it('keeps the memory-saving preset, where the constraint is real', async () => {
		const args = await argsFor(new FakeEngine(false), '1080p');

		expect(flag(args, '-preset')).toBe('ultrafast');
	});

	it('keeps the single thread', async () => {
		const args = await argsFor(new FakeEngine(false), '1080p');

		expect(flag(args, '-threads')).toBe('1');
	});
});

describe('bitrate follows resolution', () => {
	it('gives 4K far more than 1080p', async () => {
		expect(BITRATE_FOR_RESOLUTION['4k']).toBeGreaterThan(BITRATE_FOR_RESOLUTION['1080p'] * 3);
	});

	it('rises with every step up in resolution', async () => {
		const order: Resolution[] = ['480p', '720p', '1080p', '4k'];
		const rates = order.map((r) => BITRATE_FOR_RESOLUTION[r]);

		expect(rates).toEqual([...rates].sort((a, b) => a - b));
	});

	it('reaches the encoder', async () => {
		const args = await argsFor(new FakeEngine(true), '4k');

		expect(flag(args, '-b:v')).toBe(`${BITRATE_FOR_RESOLUTION['4k']}k`);
	});

	it('gives 4K a bitrate no 1080p export would use', async () => {
		// The bug: 3840x2160 encoded at 5000k, a rate meant for a quarter of
		// the pixels.
		const args = await argsFor(new FakeEngine(true), '4k');

		expect(parseInt(flag(args, '-b:v') ?? '0', 10)).toBeGreaterThan(20000);
	});
});
