import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportTimeline } from './export-pipeline.js';
import type { FFmpegEngine, OperationCallback } from './ffmpeg-engine.js';
import { createClip } from '$lib/types/timeline.js';
import type { Clip, Track, MosaicRegion } from '$lib/types/timeline.js';
import type { ExportConfig } from '$lib/types/export.js';
import type { KeyframeTrack } from '$lib/types/keyframes.js';

/**
 * Drives the real export pipeline against the real FFmpeg binary.
 *
 * The unit tests prove each filter builder in isolation; this proves they
 * compose into a filtergraph FFmpeg will actually run, and that the result is a
 * decodable video. It mirrors the desktop engine deliberately — a working
 * directory plus bare filenames — so it exercises the same code path the
 * shipped app does.
 */

const BUNDLED = path.resolve(
	__dirname,
	'../../../../desktop/src-tauri/binaries/loomo-ffmpeg-x86_64-unknown-linux-gnu'
);

function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
	const bundled = name === 'ffmpeg' ? BUNDLED : BUNDLED.replace('loomo-ffmpeg', 'loomo-ffprobe');
	if (existsSync(bundled)) return bundled;
	try {
		execFileSync(name, ['-version'], { stdio: 'ignore' });
		return name;
	} catch {
		return null;
	}
}

const ffmpegBin = resolveBinary('ffmpeg');
const ffprobeBin = resolveBinary('ffprobe');

/** The same virtual-filename contract the desktop engine implements. */
class NodeFFmpegEngine implements FFmpegEngine {
	ready = true;
	busy = false;
	currentOperation: string | null = null;
	initProgress = 'Ready';
	/** Mirrors the native engine: a real binary has no input-size ceiling. */
	readonly maxInputBytes = null;
	/** And, like the desktop, it writes to a real directory. */
	readonly persistentStore = true;

	constructor(private dir: string) {}

	async initialize(): Promise<void> {}

	async exec(args: string[], callbacks: OperationCallback = {}): Promise<number> {
		try {
			execFileSync(ffmpegBin!, ['-hide_banner', '-nostdin', '-y', ...args], {
				cwd: this.dir,
				stdio: ['ignore', 'ignore', 'pipe'],
				encoding: 'utf8',
			});
			callbacks.onProgress?.(1);
			return 0;
		} catch (error: any) {
			throw new Error(
				`ffmpeg failed\nargs: ${args.join(' ')}\n${String(error.stderr ?? error.message)}`
			);
		}
	}

	async writeFile(name: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		writeFileSync(path.join(this.dir, name), data instanceof Uint8Array ? data : new Uint8Array(data));
	}

	async readFile(name: string): Promise<ArrayBuffer> {
		const buffer = readFileSync(path.join(this.dir, name));
		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
	}

	async fileSize(name: string): Promise<number> {
		try {
			return statSync(path.join(this.dir, name)).size;
		} catch {
			return 0;
		}
	}

	async fileExists(name: string): Promise<boolean> {
		return (await this.fileSize(name)) > 0;
	}

	async probe(name: string) {
		const output = execFileSync(
			ffprobeBin!,
			[
				'-v', 'error',
				'-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
				'-of', 'json',
				path.join(this.dir, name),
			],
			{ encoding: 'utf8' }
		);
		const json = JSON.parse(output);
		const streams: any[] = json.streams ?? [];
		const video = streams.find((s) => s.codec_type === 'video') ?? {};
		const audio = streams.find((s) => s.codec_type === 'audio');
		return {
			duration: parseFloat(json.format?.duration ?? '0'),
			width: video.width ?? 0,
			height: video.height ?? 0,
			fps: 0,
			codec: video.codec_name ?? '',
			audioCodec: audio?.codec_name ?? '',
			bitrate: 0,
		};
	}

	async deleteFile(name: string): Promise<void> {
		try {
			unlinkSync(path.join(this.dir, name));
		} catch {
			/* already gone */
		}
	}

	terminate(): void {}
}

let workDir: string;
let sourceFile: File;
let imageFile: File;
let musicFile: File;

const CONFIG: ExportConfig = {
	format: 'mp4',
	videoCodec: 'libx264',
	audioCodec: 'aac',
	resolution: '480p',
	fps: 24,
	videoBitrate: 800,
	audioBitrate: 96,
	quality: 23,
};

function videoTrack(clips: Clip[]): Track[] {
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

function baseClip(over: Partial<Clip> = {}): Clip {
	return createClip({
		id: 'clip-1',
		name: 'source.mp4',
		type: 'video',
		assetId: 'asset-1',
		trackId: 'track-1',
		timelineStart: 0,
		duration: 2,
		...over,
	});
}

function keyframeTrack(property: KeyframeTrack['property'], values: [number, number][]): KeyframeTrack {
	return {
		property,
		keyframes: values.map(([time, value], index) => ({
			id: `${property}-${index}`,
			time,
			value,
			easing: 'ease-in-out' as const,
		})),
	};
}

async function runExport(clips: Clip[], overrides: Partial<ExportConfig> = {}): Promise<Uint8Array> {
	const engine = new NodeFFmpegEngine(workDir);
	const result = await exportTimeline(
		engine,
		videoTrack(clips),
		[],
		[],
		{ ...CONFIG, ...overrides },
		() => {},
		() => ({ file: sourceFile, name: 'source.mp4' })
	);

	// This engine keeps files on disk, so the export hands back a name rather
	// than bytes — exactly as the desktop does.
	expect(result.scratchName).toBeTruthy();
	return new Uint8Array(readFileSync(path.join(workDir, result.scratchName!)));
}

/** Confirms the exported bytes are a real, decodable video. */
function probe(bytes: Uint8Array): { duration: number; width: number; height: number } {
	const probePath = path.join(workDir, `probe-${Math.round(bytes.byteLength)}.mp4`);
	writeFileSync(probePath, bytes);
	const output = execFileSync(
		ffprobeBin!,
		[
			'-v', 'error',
			'-show_entries', 'format=duration:stream=width,height',
			'-of', 'json',
			probePath,
		],
		{ encoding: 'utf8' }
	);
	const json = JSON.parse(output);
	const stream = (json.streams ?? []).find((s: any) => s.width) ?? {};
	return {
		duration: parseFloat(json.format?.duration ?? '0'),
		width: stream.width ?? 0,
		height: stream.height ?? 0,
	};
}

/** Every stream in the file, so an export can be checked for what it must NOT contain. */
function probeStreams(bytes: Uint8Array, ext: string): { codec_type: string; codec_name: string }[] {
	const probePath = path.join(workDir, `probe-streams-${bytes.byteLength}.${ext}`);
	writeFileSync(probePath, bytes);
	const output = execFileSync(
		ffprobeBin!,
		['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', probePath],
		{ encoding: 'utf8' }
	);
	return JSON.parse(output).streams ?? [];
}

/** Runs a real multi-track timeline through the pipeline. */
async function runMultiTrack(
	specs: { id: string; type: 'video' | 'audio'; clips: Clip[] }[],
	extraAssets: Record<string, { file: File; name: string }>
): Promise<Uint8Array> {
	const engine = new NodeFFmpegEngine(workDir);
	const tracks: Track[] = specs.map((spec) => ({
		id: spec.id,
		name: spec.id,
		type: spec.type,
		clips: spec.clips,
		muted: false,
		locked: false,
		visible: true,
		height: 80,
		volume: 1,
	}));

	const result = await exportTimeline(
		engine,
		tracks,
		[],
		[],
		CONFIG,
		() => {},
		(assetId) => extraAssets[assetId] ?? { file: sourceFile, name: 'source.mp4' }
	);

	expect(result.scratchName).toBeTruthy();
	return new Uint8Array(readFileSync(path.join(workDir, result.scratchName!)));
}

/** Whether the frame at `time` is dominated by red — the overlay's colour. */
function frameIsRedAt(bytes: Uint8Array, time: number): boolean {
	const filePath = path.join(workDir, `frame-src-${bytes.byteLength}-${time}.mp4`);
	writeFileSync(filePath, bytes);
	const framePath = path.join(workDir, `frame-${bytes.byteLength}-${time}.rawvideo`);
	execFileSync(
		ffmpegBin!,
		[
			'-hide_banner', '-v', 'error', '-y',
			'-ss', String(time), '-i', filePath,
			'-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
			framePath,
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	const [r, g, b] = readFileSync(framePath);
	// Averaged to a single pixel, a full-frame red overlay dominates; the
	// testsrc2 base never does.
	return r > 100 && r > g * 2 && r > b * 2;
}

/** Mean volume in dB, to tell an audible mix from a silent stream. */
function meanVolume(bytes: Uint8Array): number {
	const filePath = path.join(workDir, `vol-${bytes.byteLength}.mp4`);
	writeFileSync(filePath, bytes);
	// volumedetect reports on stderr, and ffmpeg exits 0, so the value has to
	// be read from the stream rather than caught from a failure.
	const run = spawnSync(
		ffmpegBin!,
		['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'],
		{ encoding: 'utf8' }
	);
	const output = `${run.stderr ?? ''}${run.stdout ?? ''}`;
	const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(output);
	return match ? parseFloat(match[1]) : -Infinity;
}

async function exportAndProbe(clips: Clip[]) {
	const bytes = await runExport(clips);
	expect(bytes.byteLength).toBeGreaterThan(1000);
	return probe(bytes);
}

describe.skipIf(!ffmpegBin || !ffprobeBin)('export pipeline end to end', () => {
	beforeAll(() => {
		workDir = mkdtempSync(path.join(tmpdir(), 'loomo-export-'));
		const source = path.join(workDir, 'source-original.mp4');
		// A real encoded file with both video and audio, so the pipeline is not
		// exercised against a synthetic lavfi source it would never see in life.
		execFileSync(
			ffmpegBin!,
			[
				'-hide_banner', '-y',
				'-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=24:duration=3',
				'-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
				'-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
				'-c:a', 'aac', '-shortest',
				source,
			],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);
		const bytes = readFileSync(source);
		sourceFile = new File([bytes], 'source.mp4', { type: 'video/mp4' });

		const image = path.join(workDir, 'overlay-original.png');
		execFileSync(
			ffmpegBin!,
			['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1', '-frames:v', '1', image],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);
		imageFile = new File([readFileSync(image)], 'overlay.png', { type: 'image/png' });

		const music = path.join(workDir, 'music-original.m4a');
		execFileSync(
			ffmpegBin!,
			['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:a', 'aac', music],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);
		musicFile = new File([readFileSync(music)], 'music.m4a', { type: 'audio/mp4' });
	});

	afterAll(() => {
		if (workDir) rmSync(workDir, { recursive: true, force: true });
	});

	it('keeps an image placed on a second video track', async () => {
		// The bug: the export read one track, so this image showed in the
		// preview and was simply absent from the file.
		const base = baseClip({ id: 'base-clip', trackId: 'track-1' });
		const overlay = createClip({
			id: 'img-clip',
			name: 'overlay.png',
			type: 'image',
			assetId: 'asset-image',
			trackId: 'track-2',
			timelineStart: 0.5,
			duration: 1,
		});

		const bytes = await runMultiTrack(
			[
				{ id: 'track-1', type: 'video', clips: [base] },
				{ id: 'track-2', type: 'video', clips: [overlay] },
			],
			{ 'asset-image': { file: imageFile, name: 'overlay.png' } }
		);

		// The overlay is a solid red rectangle; if compositing ran, red appears
		// during its span and not before it.
		expect(frameIsRedAt(bytes, 1.0)).toBe(true);
	}, 120_000);

	it('shows that overlay only within its own span', async () => {
		const base = baseClip({ id: 'base-clip', trackId: 'track-1', duration: 3 });
		const overlay = createClip({
			id: 'img-clip',
			name: 'overlay.png',
			type: 'image',
			assetId: 'asset-image',
			trackId: 'track-2',
			timelineStart: 2,
			duration: 1,
		});

		const bytes = await runMultiTrack(
			[
				{ id: 'track-1', type: 'video', clips: [base] },
				{ id: 'track-2', type: 'video', clips: [overlay] },
			],
			{ 'asset-image': { file: imageFile, name: 'overlay.png' } }
		);

		expect(frameIsRedAt(bytes, 0.5)).toBe(false);
		expect(frameIsRedAt(bytes, 2.5)).toBe(true);
	}, 120_000);

	it('keeps a music clip placed on an audio track', async () => {
		const base = baseClip({ id: 'base-clip', trackId: 'track-1', duration: 3 });
		const music = createClip({
			id: 'music-clip',
			name: 'music.m4a',
			type: 'audio',
			assetId: 'asset-music',
			trackId: 'track-a',
			timelineStart: 0,
			duration: 2,
		});

		const bytes = await runMultiTrack(
			[
				{ id: 'track-1', type: 'video', clips: [base] },
				{ id: 'track-a', type: 'audio', clips: [music] },
			],
			{ 'asset-music': { file: musicFile, name: 'music.m4a' } }
		);

		const streams = probeStreams(bytes, 'mp4');
		expect(streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1);
		// The mix must be audible, not a silent stream.
		expect(meanVolume(bytes)).toBeGreaterThan(-60);
	}, 120_000);

	it('leaves a single-track timeline exactly as it was', async () => {
		// The composite pass must be inert when there is nothing to composite.
		const result = await exportAndProbe([baseClip()]);

		expect(result.width).toBe(854);
		expect(result.height).toBe(480);
	}, 60_000);

	it('exports audio only to M4A, with no video stream', async () => {
		// The format list offered M4A from the start, but the pipeline had no
		// branch for it and wrote an H.264 stream into the file.
		const bytes = await runExport([baseClip()], { format: 'm4a' });
		const streams = probeStreams(bytes, 'm4a');

		expect(streams.map((s) => s.codec_type)).toEqual(['audio']);
	}, 60_000);

	it('produces a real GIF rather than failing on the muxer', async () => {
		// Previously: "gif muxer supports only codec gif for type video".
		const bytes = await runExport([baseClip()], { format: 'gif' });
		const streams = probeStreams(bytes, 'gif');

		expect(streams[0]?.codec_name).toBe('gif');
	}, 120_000);

	it('gives the GIF the frames it should have', async () => {
		const bytes = await runExport([baseClip()], { format: 'gif' });

		expect(bytes.byteLength).toBeGreaterThan(1000);
		expect(probe(bytes).width).toBeGreaterThan(0);
	}, 120_000);

	it('exports a plain clip', async () => {
		const result = await exportAndProbe([baseClip()]);
		expect(result.width).toBe(854);
		expect(result.height).toBe(480);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 60_000);

	it('exports a Motion FX clip — the effect no longer vanishes', async () => {
		// Before the fix this took the stream-copy path and produced a file with
		// no effect applied at all.
		const result = await exportAndProbe([
			baseClip({ videoEffect: { type: 'vhs', intensity: 70 } }),
		]);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 60_000);

	it('exports every Motion FX preset', async () => {
		for (const type of ['blur', 'glitch', 'filmic', 'glow', 'cinematic', 'mirror'] as const) {
			const result = await exportAndProbe([baseClip({ videoEffect: { type, intensity: 60 } })]);
			expect(result.duration, `${type} produced no usable output`).toBeGreaterThan(1.5);
		}
	}, 180_000);

	it('exports mosaic regions', async () => {
		const mosaics: MosaicRegion[] = [
			{ id: 'm1', x: 10, y: 10, width: 30, height: 30, mode: 'pixelate', strength: 60, startTime: null, endTime: null },
			{ id: 'm2', x: 55, y: 45, width: 25, height: 25, mode: 'blur', strength: 80, startTime: 0.5, endTime: 1.5 },
		];
		const result = await exportAndProbe([baseClip({ mosaics })]);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 60_000);

	it('exports keyframed colour and rotation', async () => {
		const result = await exportAndProbe([
			baseClip({
				keyframes: [
					keyframeTrack('brightness', [[0, 60], [2, 140]]),
					keyframeTrack('rotation', [[0, 0], [2, 20]]),
				],
			}),
		]);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 60_000);

	it('exports keyframed scale and position through the compositor', async () => {
		const result = await exportAndProbe([
			baseClip({
				keyframes: [
					keyframeTrack('scale', [[0, 60], [2, 100]]),
					keyframeTrack('positionX', [[0, -20], [2, 20]]),
					keyframeTrack('positionY', [[0, 0], [2, 10]]),
				],
			}),
		]);
		// The compositor must restore the full target frame around the clip.
		expect(result.width).toBe(854);
		expect(result.height).toBe(480);
	}, 60_000);

	it('exports keyframed opacity via the sendcmd script', async () => {
		const result = await exportAndProbe([
			baseClip({ keyframes: [keyframeTrack('opacity', [[0, 0], [2, 100]])] }),
		]);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 60_000);

	it('exports a speed curve and shortens the clip accordingly', async () => {
		const plain = await exportAndProbe([baseClip()]);
		const fast = await exportAndProbe([
			baseClip({
				speedCurve: {
					enabled: true,
					preservePitch: true,
					points: [
						{ id: 'a', time: 0, speed: 2 },
						{ id: 'b', time: 2, speed: 2 },
					],
				},
			}),
		]);
		// Double speed should roughly halve the output.
		expect(fast.duration).toBeLessThan(plain.duration * 0.75);
	}, 120_000);

	it('exports audio denoise', async () => {
		const result = await exportAndProbe([baseClip({ denoiseStrength: 70 })]);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 60_000);

	it('exports everything stacked together', async () => {
		const result = await exportAndProbe([
			baseClip({
				videoEffect: { type: 'cinematic', intensity: 50 },
				denoiseStrength: 40,
				mosaics: [
					{ id: 'm1', x: 5, y: 5, width: 20, height: 20, mode: 'pixelate', strength: 50, startTime: null, endTime: null },
				],
				keyframes: [
					keyframeTrack('scale', [[0, 80], [2, 110]]),
					keyframeTrack('positionX', [[0, -10], [2, 10]]),
					keyframeTrack('brightness', [[0, 90], [2, 115]]),
					keyframeTrack('volume', [[0, 0], [2, 100]]),
				],
			}),
		]);
		expect(result.width).toBe(854);
		expect(result.height).toBe(480);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 90_000);

	it('joins multiple clips — the combiner case', async () => {
		const result = await exportAndProbe([
			baseClip({ id: 'c1', timelineStart: 0, duration: 1, sourceStart: 0, sourceEnd: 1 }),
			baseClip({ id: 'c2', timelineStart: 1, duration: 1, sourceStart: 1, sourceEnd: 2,
				videoEffect: { type: 'filmic', intensity: 50 } }),
		]);
		expect(result.duration).toBeGreaterThan(1.5);
	}, 90_000);
});
