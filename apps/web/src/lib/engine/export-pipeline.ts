import type { ExportConfig, ExportProgress } from '$lib/types/index.js';
import type { Track, Clip, ClipFilters, ClipTransform, ClipCrop } from '$lib/types/index.js';
import type { Transition, TextOverlay, ShapeOverlay, CaptionTrack } from '$lib/types/index.js';
import type { FFmpegEngine } from './ffmpeg-engine.js';
import { getShapeById } from '$lib/utils/shapes.js';
import { RESOLUTION_MAP } from '$lib/types/export.js';
import { DEFAULT_CLIP_FILTERS, DEFAULT_TRANSFORM, DEFAULT_CROP, DEFAULT_CHROMA_KEY, DEFAULT_CLIP_POSITION } from '$lib/types/timeline.js';
import { hasNonDefaultFilters } from '$lib/utils/filter-presets.js';
import { hasNonDefaultPosition } from '$lib/utils/pip-presets.js';
import {
	DEFAULT_LOUDNESS_TARGET,
	gainFilter,
	gainToTarget,
	loudnessAnalysisArgs,
	parseLoudnessOutput,
} from './loudness.js';
import {
	planComposite,
	buildCompositeFilter,
	inputArgsFor,
	isEmptyPlan,
	type CompositePlan,
	type CompositeSource,
} from './composite-tracks.js';
import { chromaColorToFFmpegHex } from '$lib/utils/chroma-key.js';
import type { Annotation } from '$lib/types/annotations.js';
import { buildAnnotationOverlays, hasAnnotationOverlays } from './ffmpeg-annotations.js';
import {
	buildVideoEffectFilters,
	buildMosaicSubgraph,
	buildDenoiseFilter,
	buildSpeedCurveSetpts,
	averageSpeed,
	hasVideoEffect,
	hasMosaics,
	hasSpeedCurve,
} from './ffmpeg-filters.js';
import {
	buildKeyframeColorFilter,
	buildKeyframeRotationFilter,
	buildKeyframeScaleFilter,
	buildKeyframeVolumeFilter,
	buildCompositeGraph,
	buildAlphaScript,
	hasAnyKeyframes,
	hasGeometryKeyframes,
	type AlphaScript,
} from './keyframe-graph.js';

/**
 * Looks up the bytes behind a clip.
 *
 * `scratchName` is the file's name in the native scratch directory when import
 * staged it there; the export reuses that staging instead of copying the file
 * through memory a second time.
 */
export type AssetResolver = (
	assetId: string
) => { file: File; name: string; scratchName?: string } | undefined;

/**
 * Where the finished render ended up.
 *
 * Exactly one of `blob` and `scratchName` is set. The desktop leaves the file
 * on disk and passes its name, so hundreds of megabytes never cross into
 * JavaScript; the web build has nowhere to leave it and hands back bytes.
 */
export interface ExportResult {
	blob: Blob | null;
	scratchName: string | null;
	size: number;
}

/**
 * Export the timeline to a video file.
 *
 * Strategies:
 * A) Stream copy         — no effects, source resolution matches target → instant
 * B) Re-encode per-clip  — resolution change needed (e.g. 4K), no cross-clip effects
 *                          Processes ONE file at a time → low memory
 * C) filter_complex      — text overlays or transitions → full re-encode (high memory)
 */
export async function exportTimeline(
	ffmpeg: FFmpegEngine,
	tracks: Track[],
	transitions: Transition[],
	textOverlays: TextOverlay[],
	config: ExportConfig,
	onProgress: (progress: ExportProgress) => void,
	getAssetFile: AssetResolver,
	shapeOverlays: ShapeOverlay[] = [],
	captionTrack?: CaptionTrack,
	annotations: Annotation[] = []
): Promise<ExportResult> {
	const startTime = Date.now();

	const progress = (stage: ExportProgress['stage'], p: number) => {
		onProgress({
			stage,
			progress: p,
			currentFrame: 0,
			totalFrames: 0,
			elapsed: Date.now() - startTime,
			eta: 0,
			outputSize: 0,
		});
	};

	progress('preparing', 0);

	const videoTrack = tracks.find((t) => t.type === 'video' && t.clips.length > 0);
	if (!videoTrack || videoTrack.clips.length === 0) {
		throw new Error('No video clips to export');
	}

	const sortedClips = [...videoTrack.clips].sort((a, b) => a.timelineStart - b.timelineStart);
	const hasClipFilters = sortedClips.some((c) => c.filters && hasNonDefaultFilters(c.filters));
	const hasClipTransforms = sortedClips.some((c) => hasNonDefaultTransform(c) || hasNonDefaultCrop(c));
	const hasChromaKey = sortedClips.some((c) => c.chromaKey?.enabled);
	const hasReversed = sortedClips.some((c) => c.reversed);
	const hasPipPositions = sortedClips.some((c) => c.position && hasNonDefaultPosition(c.position));
	const hasAudioFades = sortedClips.some((c) => (c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0);
	const hasNoiseSuppression = sortedClips.some((c) => c.noiseSuppression || (c.denoiseStrength ?? 0) > 0);
	const hasSpeedChanges = sortedClips.some((c) => c.speed !== 1);
	const hasCaptions = !!(captionTrack?.enabled && captionTrack.segments.length > 0);
	// Anything below that is missing from this list gets silently dropped: a
	// clip whose only change is one of these would otherwise take the
	// stream-copy path and come out untouched. That is precisely how Motion FX
	// used to disappear on export.
	const hasMotionEffects = sortedClips.some(hasVideoEffect);
	const hasMosaicRegions = sortedClips.some(hasMosaics);
	const hasSpeedCurves = sortedClips.some(hasSpeedCurve);
	const hasAnimation = sortedClips.some(hasAnyKeyframes);
	const hasDrawings = hasAnnotationOverlays(annotations);
	const hasEffects = textOverlays.length > 0 || shapeOverlays.length > 0 || transitions.length > 0 || hasClipFilters || hasClipTransforms || hasChromaKey || hasReversed || hasPipPositions || hasAudioFades || hasNoiseSuppression || hasSpeedChanges || hasCaptions || hasMotionEffects || hasMosaicRegions || hasSpeedCurves || hasAnimation || hasDrawings;
	const outputFile = `output.${config.format}`;

	const targetRes = RESOLUTION_MAP[config.resolution];
	const targetWidth = config.customWidth ?? targetRes.width;
	const targetHeight = config.customHeight ?? targetRes.height;

	// Probe source resolution to decide if scaling is needed. When the size
	// cannot be read, scale anyway: stream-copying on a failed probe would
	// quietly hand back the source resolution instead of the one requested.
	let needsScale = false;
	if (!hasEffects) {
		const firstAsset = getAssetFile(sortedClips[0].assetId);
		if (firstAsset) {
			const sourceRes = await probeVideoResolution(firstAsset.file);
			needsScale =
				sourceRes.width <= 0 ||
				sourceRes.height <= 0 ||
				sourceRes.width !== targetWidth ||
				sourceRes.height !== targetHeight;
		}
	}

	// Measured before the strategy is chosen: a clip that needs a correction
	// cannot be stream-copied, so this feeds the decision below.
	const audioClipsForLoudness = tracks
		.filter((t) => (t.type === 'video' ? true : !t.muted))
		.flatMap((t) => t.clips);
	const gains = config.normalizeLoudness
		? await measureLoudness(ffmpeg, audioClipsForLoudness, getAssetFile, progress)
		: new Map<string, number>();
	const hasLoudnessGain = sortedClips.some((clip) => {
		const gain = gains.get(clip.id);
		return gain !== undefined && !!gainFilter(gain);
	});

	let result: ExportResult;

	if (config.format === 'm4a') {
		// Audio only. Without this the pipeline encoded video into the .m4a and
		// called it an audio export.
		result = await exportAudioOnly(ffmpeg, sortedClips, config, outputFile, getAssetFile, progress, gains);
	} else if (config.format === 'gif') {
		// GIF needs its own muxer and a colour palette; the normal path handed
		// it libx264, which the gif muxer rejects outright.
		result = await exportGif(
			ffmpeg, tracks, transitions, textOverlays, config, targetWidth, targetHeight,
			getAssetFile, onProgress, shapeOverlays, captionTrack, annotations, startTime
		);
	} else if (hasEffects) {
		// Strategy C: filter_complex — text overlays or transitions need all clips
		result = await exportFilterComplex(
			ffmpeg, sortedClips, textOverlays, shapeOverlays, config, targetWidth, targetHeight, outputFile, getAssetFile, progress, captionTrack, annotations, gains
		);
	} else if (!needsScale && !hasLoudnessGain && sortedClips.length === 1) {
		// Strategy A: Single clip, source resolution — stream copy
		result = await exportSingleClipStreamCopy(ffmpeg, sortedClips[0], config, outputFile, getAssetFile, progress, gains);
	} else if (!needsScale && !hasLoudnessGain) {
		// Strategy A: Multi-clip, source resolution — stream copy concat
		result = await exportConcatStreamCopy(ffmpeg, sortedClips, config, outputFile, getAssetFile, progress, gains);
	} else {
		// Strategy B: Resolution change (4K, downscale, etc.) — re-encode per-clip + concat
		result = await exportReencodeConcat(
			ffmpeg, sortedClips, config, targetWidth, targetHeight, outputFile, getAssetFile, progress, gains
		);
	}

	// Anything on a second video track or an audio track is laid over the
	// finished base render. Until this existed the export read one track and
	// silently discarded the rest.
	if (config.format !== 'gif' && config.format !== 'm4a') {
		result = await compositeExtraTracks(
			ffmpeg, result, tracks, videoTrack.id, config,
			targetWidth, targetHeight, getAssetFile, progress, gains
		);
	}

	onProgress({
		stage: 'done',
		progress: 1,
		currentFrame: 0,
		totalFrames: 0,
		elapsed: Date.now() - startTime,
		eta: 0,
		outputSize: result.size,
	});

	return result;
}

// ── Probe source resolution (no WASM needed) ───────────────────────

/**
 * Reads a source's dimensions with a throwaway `<video>` element.
 *
 * Returns zeros when the size cannot be determined — in a worker or the
 * desktop engine there is no DOM to ask. Callers must treat zeros as "unknown"
 * and scale anyway, rather than assuming the source already matches.
 */
function probeVideoResolution(file: File): Promise<{ width: number; height: number }> {
	if (typeof document === 'undefined') {
		return Promise.resolve({ width: 0, height: 0 });
	}

	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		video.preload = 'metadata';

		const timer = setTimeout(() => {
			URL.revokeObjectURL(url);
			resolve({ width: 0, height: 0 });
		}, 5000);

		video.onloadedmetadata = () => {
			clearTimeout(timer);
			resolve({ width: video.videoWidth, height: video.videoHeight });
			URL.revokeObjectURL(url);
		};

		video.onerror = () => {
			clearTimeout(timer);
			resolve({ width: 0, height: 0 });
			URL.revokeObjectURL(url);
		};

		video.src = url;
	});
}

// ── Loudness matching ───────────────────────────────────────────────

/** Correction in dB for each clip, by clip id. Absent means leave it alone. */
export type LoudnessGains = Map<string, number>;

/**
 * Measures every clip that contributes sound and works out its correction.
 *
 * One analysis pass per clip, decoding audio only. Clips with no audio, or
 * whose asset cannot be found, are simply left out of the map; a failed
 * measurement must never fail an export, since the worst case without it is
 * the levels people had before.
 */
async function measureLoudness(
	ffmpeg: FFmpegEngine,
	clips: Clip[],
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void
): Promise<LoudnessGains> {
	const gains: LoudnessGains = new Map();
	const measured = new Map<string, number>();

	for (let i = 0; i < clips.length; i++) {
		const clip = clips[i];
		if (clip.muted || clip.type === 'image') continue;

		const asset = getAssetFile(clip.assetId);
		if (!asset) continue;

		// Two clips cut from one source over the same range measure the same;
		// the key covers the trim because a quiet passage is not the whole file.
		const key = `${clip.assetId}:${clip.sourceStart.toFixed(2)}:${clip.duration.toFixed(2)}`;
		const cached = measured.get(key);
		if (cached !== undefined) {
			gains.set(clip.id, cached);
			continue;
		}

		progress('preparing', (i / clips.length) * 0.05);

		const temps: string[] = [];
		try {
			const input = await prepareInput(ffmpeg, asset, `loud_${clip.id}.${getExt(asset.name)}`);
			if (input.disposable) temps.push(input.path);

			let output = '';
			const exitCode = await ffmpeg.exec(
				loudnessAnalysisArgs(input.path, {
					sourceStart: clip.sourceStart,
					duration: clip.duration,
				}),
				{ onLog: (line) => { output += `${line}\n`; } }
			);

			if (exitCode === 0) {
				const measurement = parseLoudnessOutput(output);
				if (measurement) {
					const gain = gainToTarget(measurement, DEFAULT_LOUDNESS_TARGET);
					measured.set(key, gain);
					gains.set(clip.id, gain);
				}
			}
		} catch (error) {
			console.warn(`[export] loudness measurement failed for "${clip.name}":`, error);
		} finally {
			await cleanup(ffmpeg, temps);
		}
	}

	return gains;
}

// ── Compositing the tracks the base render did not cover ────────────

/**
 * Lays every other track over the finished base render.
 *
 * Done as a second pass rather than by rebuilding the main filtergraph: the
 * existing strategies already handle effects, transitions, speed and
 * keyframes, and none of that has to change for an image to appear on top of
 * it. The cost is one extra encode of an already-rendered file.
 */
async function compositeExtraTracks(
	ffmpeg: FFmpegEngine,
	base: ExportResult,
	tracks: Track[],
	baseTrackId: string,
	config: ExportConfig,
	width: number,
	height: number,
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void,
	gains?: LoudnessGains
): Promise<ExportResult> {
	const { overlayClips, audioClips } = planComposite(tracks, baseTrackId);
	if (overlayClips.length === 0 && audioClips.length === 0) return base;

	progress('rendering', 0.9);

	const temps: string[] = [];
	const basePath = await materialise(ffmpeg, base, 'composite_base.mp4');
	if (!base.scratchName) temps.push(basePath);

	const plan: CompositePlan = { overlays: [], audio: [] };
	for (const clip of overlayClips) {
		const source = await sourceFor(ffmpeg, clip, getAssetFile, temps);
		if (source) plan.overlays.push(source);
	}
	for (const clip of audioClips) {
		const source = await sourceFor(ffmpeg, clip, getAssetFile, temps);
		if (source) plan.audio.push(source);
	}
	if (isEmptyPlan(plan)) return base;

	const baseHasAudio = await hasAudioStream(ffmpeg, basePath);
	const { filter, videoLabel, audioLabel } = buildCompositeFilter(plan, {
		width,
		height,
		fps: config.fps,
		baseHasAudio,
		gains,
	});

	const tuning = encoderTuning(ffmpeg);
	const outputFile = `composited.${config.format}`;
	const args: string[] = ['-i', basePath];
	for (const source of plan.overlays) args.push(...inputArgsFor(source, config.fps));
	for (const source of plan.audio) args.push(...inputArgsFor(source, config.fps));

	if (filter) args.push('-filter_complex', filter);
	args.push('-map', videoLabel.includes(':') ? videoLabel : `[${videoLabel}]`);
	if (audioLabel) {
		args.push('-map', audioLabel.includes(':') ? audioLabel : `[${audioLabel}]`);
	}

	args.push('-c:v', config.videoCodec, '-preset', tuning.preset);
	if (config.videoBitrate > 0) args.push('-b:v', `${config.videoBitrate}k`);
	if (audioLabel) {
		args.push('-c:a', config.audioCodec);
		if (config.audioBitrate > 0) args.push('-b:a', `${config.audioBitrate}k`);
	}
	// The composite must not outlast the base render just because an overlay
	// was dragged past the end of the timeline. A probe that reports nothing
	// means no cap — truncating to zero would produce an empty file.
	const baseDuration = await durationOf(ffmpeg, basePath);
	if (baseDuration > 0) args.push('-t', String(baseDuration));
	args.push('-threads', tuning.threads, '-movflags', '+faststart', '-y', outputFile);

	const exitCode = await ffmpeg.exec(args, {
		onProgress: (p) => progress('encoding', 0.9 + p * 0.08),
	});
	if (exitCode !== 0) {
		await cleanup(ffmpeg, [...temps, outputFile]);
		throw new Error(`Compositing extra tracks failed (exit code ${exitCode})`);
	}

	const result = await finishOutput(ffmpeg, outputFile, config.format);
	// The base render has been superseded, and so have any staged copies this
	// pass made; sources staged at import are left alone by `cleanup` callers.
	await cleanup(ffmpeg, temps);
	if (base.scratchName) await cleanup(ffmpeg, [base.scratchName]);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);
	return result;
}

/** Stages a clip's asset if needed and describes it for the filtergraph. */
async function sourceFor(
	ffmpeg: FFmpegEngine,
	clip: Clip,
	getAssetFile: AssetResolver,
	temps: string[]
): Promise<CompositeSource | null> {
	const asset = getAssetFile(clip.assetId);
	if (!asset) return null;

	const input = await prepareInput(ffmpeg, asset, `ovl_${clip.id}.${getExt(asset.name)}`);
	if (input.disposable) temps.push(input.path);
	return { path: input.path, clip, isStill: clip.type === 'image' };
}

/**
 * Whether a rendered file carries sound.
 *
 * Mapping `0:a` when there is no audio stream fails the whole command, and a
 * timeline whose only audio is a music track is an ordinary case.
 */
async function hasAudioStream(ffmpeg: FFmpegEngine, path: string): Promise<boolean> {
	if (!ffmpeg.probe) return true;
	try {
		const probe = await ffmpeg.probe(path);
		return !!probe.audioCodec;
	} catch {
		return true;
	}
}

/** Length of the base render, so the composite can be capped to it. */
async function durationOf(ffmpeg: FFmpegEngine, path: string): Promise<number> {
	if (!ffmpeg.probe) return 0;
	try {
		return (await ffmpeg.probe(path)).duration;
	} catch {
		return 0;
	}
}

// ── Audio-only export ───────────────────────────────────────────────

/**
 * Renders just the audio.
 *
 * The format list has offered M4A since the beginning, but the pipeline had no
 * branch for it: the normal video strategies ran, wrote an H.264 stream into a
 * file named .m4a, and reported success. The result played as video in
 * anything that ignored the extension.
 */
async function exportAudioOnly(
	ffmpeg: FFmpegEngine,
	sortedClips: Clip[],
	config: ExportConfig,
	outputFile: string,
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void,
	gains?: LoudnessGains
): Promise<ExportResult> {
	const temps: string[] = [];
	const segments: string[] = [];
	const total = sortedClips.length;

	for (let i = 0; i < total; i++) {
		const clip = sortedClips[i];
		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		progress('preparing', (i / total) * 0.4);
		const input = await prepareInput(ffmpeg, asset, `asrc_${i}.${getExt(asset.name)}`);
		if (input.disposable) temps.push(input.path);

		const segment = `aseg_${i}.m4a`;
		const args: string[] = [];
		if (clip.sourceStart > 0.01) args.push('-ss', String(clip.sourceStart));
		args.push('-i', input.path);
		args.push('-t', String(clip.duration));
		// -vn is the whole point: no video stream reaches the muxer.
		args.push('-vn');

		const audioFilters = buildFfmpegAudioFilters(clip, gains);
		if (audioFilters.length > 0) args.push('-af', audioFilters.join(','));

		args.push('-c:a', config.audioCodec);
		if (config.audioBitrate > 0) args.push('-b:a', `${config.audioBitrate}k`);
		args.push('-y', segment);

		progress('encoding', 0.4 + (i / total) * 0.4);
		const exitCode = await ffmpeg.exec(args);
		if (exitCode !== 0) {
			await cleanup(ffmpeg, [...temps, ...segments, segment]);
			throw new Error(`FFmpeg audio export failed for clip ${i + 1} (exit code ${exitCode})`);
		}
		segments.push(segment);
	}

	if (segments.length === 1) {
		progress('finalizing', 0.9);
		// Rename by copy: the caller expects the agreed output name.
		const exitCode = await ffmpeg.exec(['-i', segments[0], '-c', 'copy', '-y', outputFile]);
		if (exitCode !== 0) {
			await cleanup(ffmpeg, [...temps, ...segments]);
			throw new Error(`FFmpeg audio export failed (exit code ${exitCode})`);
		}
	} else {
		progress('rendering', 0.85);
		const listPath = 'aconcat_list.txt';
		const list = segments.map((f) => `file '${f}'`).join('\n');
		await ffmpeg.writeFile(listPath, new TextEncoder().encode(list).buffer);
		temps.push(listPath);

		const exitCode = await ffmpeg.exec([
			'-f', 'concat', '-safe', '0', '-i', listPath,
			'-c', 'copy', '-y', outputFile,
		]);
		if (exitCode !== 0) {
			await cleanup(ffmpeg, [...temps, ...segments]);
			throw new Error(`FFmpeg audio concat failed (exit code ${exitCode})`);
		}
	}

	progress('finalizing', 0.95);
	const result = await finishOutput(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...temps, ...segments]);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);
	return result;
}

// ── Animated GIF ────────────────────────────────────────────────────

/** Above this, a GIF is unusable regardless of what the timeline holds. */
const GIF_MAX_WIDTH = 640;
const GIF_FPS = 15;

/**
 * Renders the timeline, then converts it to GIF through a generated palette.
 *
 * GIF was offered in the format list but never implemented: the gif muxer
 * accepts only the gif codec, so being handed libx264 made it fail with
 * "gif muxer supports only codec gif for type video".
 *
 * The video is assembled by the ordinary strategies first — one nested call,
 * with the format forced to MP4 so it cannot recurse again — because every
 * effect, transition and overlay has to be applied before the colour
 * quantisation, not after.
 */
async function exportGif(
	ffmpeg: FFmpegEngine,
	tracks: Track[],
	transitions: Transition[],
	textOverlays: TextOverlay[],
	config: ExportConfig,
	targetWidth: number,
	targetHeight: number,
	getAssetFile: AssetResolver,
	onProgress: (progress: ExportProgress) => void,
	shapeOverlays: ShapeOverlay[],
	captionTrack: CaptionTrack | undefined,
	annotations: Annotation[],
	startTime: number
): Promise<ExportResult> {
	const intermediate = await exportTimeline(
		ffmpeg,
		tracksWithoutAudio(tracks),
		transitions,
		textOverlays,
		{ ...config, format: 'mp4', videoCodec: 'libx264', audioCodec: 'aac' },
		// Report the render as the first 70% of the job; the palette passes
		// that follow are not instant on a long timeline.
		(p) => onProgress({ ...p, progress: p.progress * 0.7 }),
		getAssetFile,
		shapeOverlays,
		captionTrack,
		annotations
	);

	const source = await materialise(ffmpeg, intermediate, 'gif_source.mp4');
	const palette = 'gif_palette.png';
	const width = Math.min(GIF_MAX_WIDTH, targetWidth);
	const scale = `fps=${GIF_FPS},scale=${width}:-1:flags=lanczos`;

	// Two passes: one to choose 256 colours for this clip, one to apply them.
	// A single pass uses a fixed palette and bands badly on real footage.
	const paletteExit = await ffmpeg.exec([
		'-i', source, '-vf', `${scale},palettegen=stats_mode=diff`, '-y', palette,
	]);
	if (paletteExit !== 0) {
		await cleanup(ffmpeg, [source, palette]);
		throw new Error(`GIF palette generation failed (exit code ${paletteExit})`);
	}

	const outputFile = `output.gif`;
	const exit = await ffmpeg.exec([
		'-i', source, '-i', palette,
		'-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
		'-loop', '0',
		'-y', outputFile,
	]);
	if (exit !== 0) {
		await cleanup(ffmpeg, [source, palette, outputFile]);
		throw new Error(`GIF encoding failed (exit code ${exit})`);
	}

	const result = await finishOutput(ffmpeg, outputFile, 'gif');
	await cleanup(ffmpeg, [source, palette]);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);

	onProgress({
		stage: 'done', progress: 1, currentFrame: 0, totalFrames: 0,
		elapsed: Date.now() - startTime, eta: 0, outputSize: result.size,
	});
	return result;
}

/** A GIF carries no sound, so the audio tracks are dropped before rendering. */
function tracksWithoutAudio(tracks: Track[]): Track[] {
	return tracks.filter((track) => track.type !== 'audio');
}

/**
 * Gives a nested export result a filename the next ffmpeg call can open.
 *
 * On disk it already has one. In the wasm engine the bytes came back as a Blob
 * and have to go back into the virtual filesystem.
 */
async function materialise(
	ffmpeg: FFmpegEngine,
	result: ExportResult,
	fallbackName: string
): Promise<string> {
	if (result.scratchName) return result.scratchName;
	if (!result.blob) throw new Error('Export produced neither a file nor bytes');
	await ffmpeg.writeFile(fallbackName, await result.blob.arrayBuffer());
	return fallbackName;
}

// ── Strategy A1: Single clip stream copy ────────────────────────────

async function exportSingleClipStreamCopy(
	ffmpeg: FFmpegEngine,
	clip: Clip,
	config: ExportConfig,
	outputFile: string,
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void,
	gains?: LoudnessGains
): Promise<ExportResult> {
	const asset = getAssetFile(clip.assetId);
	if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

	progress('preparing', 0.1);
	const input = await prepareInput(ffmpeg, asset, `input.${getExt(asset.name)}`);
	const inputPath = input.path;
	const temps = input.disposable ? [inputPath] : [];

	progress('rendering', 0.3);

	const args: string[] = [];
	if (clip.sourceStart > 0.01) {
		args.push('-ss', String(clip.sourceStart));
	}
	args.push('-i', inputPath);
	args.push('-t', String(clip.duration));
	args.push('-c:v', 'copy');
	args.push('-c:a', 'copy');
	args.push('-movflags', '+faststart');
	args.push('-y', outputFile);

	const exitCode = await ffmpeg.exec(args);
	if (exitCode !== 0) {
		await cleanup(ffmpeg, [...temps, outputFile]);
		throw new Error(`FFmpeg exited with code ${exitCode}`);
	}

	progress('finalizing', 0.9);
	const result = await finishOutput(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, temps);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);
	return result;
}

// ── Strategy A2: Multi-clip concat with stream copy ─────────────────

async function exportConcatStreamCopy(
	ffmpeg: FFmpegEngine,
	sortedClips: Clip[],
	config: ExportConfig,
	outputFile: string,
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void,
	gains?: LoudnessGains
): Promise<ExportResult> {
	const trimmedFiles: string[] = [];
	const total = sortedClips.length;

	for (let i = 0; i < total; i++) {
		const clip = sortedClips[i];
		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		const trimmedPath = `trimmed_${i}.mp4`;

		progress('preparing', (i / total) * 0.4);

		const input = await prepareInput(ffmpeg, asset, `src_${i}.${getExt(asset.name)}`);
		const inputPath = input.path;

		const args: string[] = [];
		if (clip.sourceStart > 0.01) {
			args.push('-ss', String(clip.sourceStart));
		}
		args.push('-i', inputPath);
		args.push('-t', String(clip.duration));
		args.push('-c:v', 'copy');
		args.push('-c:a', 'copy');
		args.push('-movflags', '+faststart');
		args.push('-y', trimmedPath);

		const exitCode = await ffmpeg.exec(args);
		if (exitCode !== 0) {
			await cleanup(ffmpeg, [
				...(input.disposable ? [inputPath] : []),
				trimmedPath, ...trimmedFiles, outputFile,
			]);
			throw new Error(`FFmpeg trim failed for clip ${i + 1} (exit code ${exitCode})`);
		}

		// Only drop the input when this export created it; a staged source is
		// still backing the preview.
		if (input.disposable) {
			try { await ffmpeg.deleteFile(inputPath); } catch {}
		}
		trimmedFiles.push(trimmedPath);
	}

	progress('rendering', 0.5);

	const concatList = trimmedFiles.map((f) => `file '${f}'`).join('\n');
	const listPath = 'concat_list.txt';
	await ffmpeg.writeFile(listPath, new TextEncoder().encode(concatList).buffer);

	const concatArgs = [
		'-f', 'concat', '-safe', '0', '-i', listPath,
		'-c:v', 'copy', '-c:a', 'copy',
		'-movflags', '+faststart',
		'-y', outputFile,
	];

	progress('encoding', 0.6);
	const exitCode = await ffmpeg.exec(concatArgs);
	if (exitCode !== 0) {
		await cleanup(ffmpeg, [...trimmedFiles, listPath, outputFile]);
		throw new Error(`FFmpeg concat failed (exit code ${exitCode})`);
	}

	progress('finalizing', 0.9);
	const result = await finishOutput(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...trimmedFiles, listPath]);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);
	return result;
}

// ── Strategy B: Re-encode per-clip + concat (4K, resolution change) ─
// Processes ONE source file at a time → keeps WASM memory low.
// Each clip is individually re-encoded to the target resolution,
// then all re-encoded clips are concatenated with stream copy.

async function exportReencodeConcat(
	ffmpeg: FFmpegEngine,
	sortedClips: Clip[],
	config: ExportConfig,
	width: number,
	height: number,
	outputFile: string,
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void,
	gains?: LoudnessGains
): Promise<ExportResult> {
	const encodedFiles: string[] = [];
	const total = sortedClips.length;
	const tuning = encoderTuning(ffmpeg);

	for (let i = 0; i < total; i++) {
		const clip = sortedClips[i];
		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		const encodedPath = `enc_${i}.mp4`;

		progress('preparing', (i / total) * 0.3);
		const input = await prepareInput(ffmpeg, asset, `src_${i}.${getExt(asset.name)}`);
		const inputPath = input.path;

		progress('encoding', 0.3 + (i / total) * 0.5);

		const args: string[] = [];
		if (clip.sourceStart > 0.01) {
			args.push('-ss', String(clip.sourceStart));
		}
		args.push('-i', inputPath);
		args.push('-t', String(clip.duration));

		// Build video filter chain: crop -> scale -> transform -> color filters
		let vf = '';

		// Crop before scaling (operates on source dimensions)
		const cropFilter = buildFfmpegCropFilter(clip);
		if (cropFilter) {
			vf += cropFilter + ',';
		}

		// Scale to target resolution with letterbox padding
		vf += `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

		// Rotation and flip transforms
		const transformFilters = buildFfmpegTransformFilters(clip);
		if (transformFilters.length > 0) {
			vf += ',' + transformFilters.join(',');
			// Re-scale after rotation (90/270 swaps dimensions)
			if (clip.transform?.rotation === 90 || clip.transform?.rotation === 270) {
				vf += `,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
			}
		}

		// Color correction filters
		const clipFilters = buildFfmpegClipFilters(clip);
		if (clipFilters.length > 0) {
			vf += ',' + clipFilters.join(',');
		}

		// Chroma key filter
		const chromaFilter = buildFfmpegChromaKeyFilter(clip);
		if (chromaFilter) {
			vf += ',' + chromaFilter;
		}

		// PiP position
		const pipFilter = buildFfmpegPositionFilter(clip, width, height);
		if (pipFilter) {
			vf += ',' + pipFilter;
		}

		// Video speed filter. This has to be appended before `-vf` is pushed:
		// strings are immutable, so mutating vf afterwards would build the
		// filter and then throw it away.
		const speedFilter = buildSpeedVideoFilter(clip.speed);
		if (speedFilter) {
			vf += ',' + speedFilter;
		}

		// Reverse video filter (requires full clip decode)
		if (clip.reversed) {
			vf += ',reverse';
		}
		args.push('-vf', vf);

		// Audio filters: volume, fades, noise suppression, speed, reverse
		const audioFilters = buildFfmpegAudioFilters(clip, gains);
		if (audioFilters.length > 0) {
			args.push('-af', audioFilters.join(','));
		}

		args.push('-c:v', config.videoCodec);
		args.push('-preset', tuning.preset);
		args.push('-c:a', config.audioCodec);

		if (config.videoBitrate > 0) {
			args.push('-b:v', `${config.videoBitrate}k`);
		}
		if (config.audioBitrate > 0) {
			args.push('-b:a', `${config.audioBitrate}k`);
		}

		args.push('-r', String(config.fps));
		args.push('-threads', tuning.threads);
		args.push('-movflags', '+faststart');
		args.push('-y', encodedPath);

		const exitCode = await ffmpeg.exec(args, {
			onProgress: (p) => {
				progress('encoding', 0.3 + ((i + p) / total) * 0.5);
			},
		});

		if (exitCode !== 0) {
			await cleanup(ffmpeg, [
				...(input.disposable ? [inputPath] : []),
				encodedPath, ...encodedFiles, outputFile,
			]);
			throw new Error(`FFmpeg re-encode failed for clip ${i + 1} (exit code ${exitCode})`);
		}

		// Free the source immediately to reclaim WASM memory — but only if this
		// export wrote it. A staged file is shared with the preview.
		if (input.disposable) {
			try { await ffmpeg.deleteFile(inputPath); } catch {}
		}
		encodedFiles.push(encodedPath);
	}

	// Single encoded clip — just read it directly
	if (encodedFiles.length === 1) {
		progress('finalizing', 0.9);
		const result = await finishOutput(ffmpeg, encodedFiles[0], config.format);
		if (!result.scratchName) await cleanup(ffmpeg, encodedFiles);
		return result;
	}

	// Multiple encoded clips — concat with stream copy (all same resolution now)
	progress('rendering', 0.85);

	const concatList = encodedFiles.map((f) => `file '${f}'`).join('\n');
	const listPath = 'concat_list.txt';
	await ffmpeg.writeFile(listPath, new TextEncoder().encode(concatList).buffer);

	const concatArgs = [
		'-f', 'concat', '-safe', '0', '-i', listPath,
		'-c:v', 'copy', '-c:a', 'copy',
		'-movflags', '+faststart',
		'-y', outputFile,
	];

	const exitCode = await ffmpeg.exec(concatArgs);
	if (exitCode !== 0) {
		await cleanup(ffmpeg, [...encodedFiles, listPath, outputFile]);
		throw new Error(`FFmpeg concat failed (exit code ${exitCode})`);
	}

	progress('finalizing', 0.95);
	const result = await finishOutput(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...encodedFiles, listPath]);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);
	return result;
}

// ── Strategy C: filter_complex for effects ──────────────────────────

async function exportFilterComplex(
	ffmpeg: FFmpegEngine,
	sortedClips: Clip[],
	textOverlays: TextOverlay[],
	shapeOverlays: ShapeOverlay[],
	config: ExportConfig,
	width: number,
	height: number,
	outputFile: string,
	getAssetFile: AssetResolver,
	progress: (stage: ExportProgress['stage'], p: number) => void,
	captionTrack?: CaptionTrack,
	annotations: Annotation[] = [],
	gains?: LoudnessGains
): Promise<ExportResult> {
	const tuning = encoderTuning(ffmpeg);

	// Write all source files (dedup by assetId)
	const inputPaths: string[] = [];
	const writtenAssets = new Map<string, string>();
	// Only paths this export created; staged sources are left alone.
	const temps: string[] = [];

	for (let i = 0; i < sortedClips.length; i++) {
		const clip = sortedClips[i];

		if (writtenAssets.has(clip.assetId)) {
			inputPaths.push(writtenAssets.get(clip.assetId)!);
			continue;
		}

		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		progress('preparing', 0.05 + (i / sortedClips.length) * 0.15);
		const input = await prepareInput(ffmpeg, asset, `input_${i}.${getExt(asset.name)}`);
		const inputPath = input.path;
		if (input.disposable) temps.push(inputPath);

		writtenAssets.set(clip.assetId, inputPath);
		inputPaths.push(inputPath);
	}

	// Build filter_complex args
	const args: string[] = [];

	for (const path of inputPaths) {
		args.push('-i', path);
	}

	const filterParts: string[] = [];
	// sendcmd scripts for animated opacity, written to the working directory
	// before the graph runs because the filter reads them by name.
	const alphaScripts: AlphaScript[] = [];

	for (let i = 0; i < sortedClips.length; i++) {
		const clip = sortedClips[i];
		const vLabel = `v${i}`;
		const aLabel = `a${i}`;

		let vChain = `[${i}:v]trim=start=${clip.sourceStart}:duration=${clip.duration},setpts=PTS-STARTPTS`;

		// Crop before scaling (operates on source dimensions)
		const cropFilter = buildFfmpegCropFilter(clip);
		if (cropFilter) {
			vChain += ',' + cropFilter;
		}

		// An animated clip is composited over a canvas further down, so it is
		// only fitted here — padding it now would scale the black bars too.
		const animatedGeometry = hasGeometryKeyframes(clip);
		const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease`;
		const pad = `,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

		vChain += `,${fit}${animatedGeometry ? '' : pad}`;

		// Rotation and flip transforms
		const transformFilters = buildFfmpegTransformFilters(clip);
		if (transformFilters.length > 0) {
			vChain += ',' + transformFilters.join(',');
			// Re-scale after rotation (90/270 swaps dimensions)
			if (clip.transform?.rotation === 90 || clip.transform?.rotation === 270) {
				vChain += `,${fit}${animatedGeometry ? '' : pad}`;
			}
		}

		// Append per-clip color correction filters
		const clipFilters = buildFfmpegClipFilters(clip);
		if (clipFilters.length > 0) {
			vChain += ',' + clipFilters.join(',');
		}

		// Chroma key filter
		const chromaFilter = buildFfmpegChromaKeyFilter(clip);
		if (chromaFilter) {
			vChain += ',' + chromaFilter;
		}

		// PiP position: scale to position size within the target resolution
		const pipFilter = buildFfmpegPositionFilter(clip, width, height);
		if (pipFilter) {
			vChain += ',' + pipFilter;
		}

		// Motion FX. Previously absent from this pipeline entirely, which is why
		// effects showed up in the preview and never in the exported file.
		const effectFilters = buildVideoEffectFilters(clip.videoEffect);
		if (effectFilters.length > 0) {
			vChain += ',' + effectFilters.join(',');
		}

		// Keyframed colour and rotation ride along as per-frame expressions.
		const keyframeColor = buildKeyframeColorFilter(clip);
		if (keyframeColor) {
			vChain += ',' + keyframeColor;
		}
		const keyframeRotation = buildKeyframeRotationFilter(clip);
		if (keyframeRotation) {
			vChain += ',' + keyframeRotation;
		}
		const keyframeScale = buildKeyframeScaleFilter(clip);
		if (keyframeScale) {
			vChain += ',' + keyframeScale;
		}

		// Animated opacity needs a command script rather than an expression.
		const alpha = buildAlphaScript(clip, i, config.fps);
		if (alpha) {
			alphaScripts.push(alpha);
			vChain += ',' + alpha.filters.join(',');
		}

		// A speed curve replaces the constant-rate filter entirely.
		const curveFilter = hasSpeedCurve(clip) ? buildSpeedCurveSetpts(clip.speedCurve!) : null;
		if (curveFilter) {
			vChain += ',' + curveFilter;
		} else {
			const speedFilter = buildSpeedVideoFilter(clip.speed);
			if (speedFilter) {
				vChain += ',' + speedFilter;
			}
		}

		// Reverse video filter (requires full clip decode)
		if (clip.reversed) {
			vChain += ',reverse';
		}

		// Compositing and mosaics both need multi-node subgraphs, so the chain
		// is terminated here and continued as separate graph segments.
		let stageLabel = vLabel;
		const needsComposite = hasGeometryKeyframes(clip);
		const needsMosaic = hasMosaics(clip);

		if (needsComposite || needsMosaic) {
			stageLabel = `${vLabel}pre`;
			filterParts.push(`${vChain}[${stageLabel}]`);

			if (needsComposite) {
				const next = needsMosaic ? `${vLabel}cmp` : vLabel;
				const composite = buildCompositeGraph(clip, stageLabel, next, width, height, config.fps);
				filterParts.push(...composite.parts);
				stageLabel = next;
			}

			if (needsMosaic) {
				filterParts.push(...buildMosaicSubgraph(stageLabel, clip.mosaics, width, height, vLabel));
			}
		} else {
			filterParts.push(`${vChain}[${vLabel}]`);
		}

		// Build audio chain with all effects
		const audioFilters = buildFfmpegAudioFilters(clip, gains);
		const denoise = buildDenoiseFilter(clip.denoiseStrength ?? 0);
		if (denoise) audioFilters.push(denoise);
		const keyframeVolume = buildKeyframeVolumeFilter(clip);
		if (keyframeVolume) audioFilters.push(keyframeVolume);
		// Audio cannot follow a varying rate, so a curve is approximated by its
		// mean; see averageSpeed for why.
		if (curveFilter) {
			audioFilters.push(...buildAtempoChain(averageSpeed(clip.speedCurve!)));
		}
		let aChain = `[${i}:a]atrim=start=${clip.sourceStart}:duration=${clip.duration},asetpts=PTS-STARTPTS`;
		if (audioFilters.length > 0) {
			aChain += ',' + audioFilters.join(',');
		}
		filterParts.push(
			`${aChain}[${aLabel}]`
		);
	}

	if (sortedClips.length > 1) {
		const streams = sortedClips.map((_, i) => `[v${i}][a${i}]`).join('');
		filterParts.push(
			`${streams}concat=n=${sortedClips.length}:v=1:a=1[outv][outa]`
		);
	} else {
		filterParts.push(`[v0]copy[outv]`);
		filterParts.push(`[a0]acopy[outa]`);
	}

	let videoOut = 'outv';
	for (let i = 0; i < textOverlays.length; i++) {
		const t = textOverlays[i];
		const nextLabel = `txt${i}`;
		const escapedText = t.text.replace(/'/g, "\\'").replace(/:/g, '\\:');

		let drawtext = `drawtext=text='${escapedText}':fontsize=${t.fontSize}:fontcolor=${t.color}`;
		drawtext += `:x=(W*${t.x}-tw/2):y=(H*${t.y}-th/2)`;
		drawtext += `:enable='between(t,${t.timelineStart},${t.timelineStart + t.duration})'`;

		// Font family
		if (t.fontFamily) {
			drawtext += `:font='${t.fontFamily}'`;
		}

		// Shadow
		if (t.shadow?.enabled) {
			drawtext += `:shadowcolor=${t.shadow.color}`;
			drawtext += `:shadowx=${t.shadow.offsetX}`;
			drawtext += `:shadowy=${t.shadow.offsetY}`;
		}

		// Outline (border)
		if (t.outline?.enabled) {
			drawtext += `:borderw=${t.outline.width}`;
			drawtext += `:bordercolor=${t.outline.color}`;
		}

		filterParts.push(`[${videoOut}]${drawtext}[${nextLabel}]`);
		videoOut = nextLabel;
	}

	// Burn in caption segments as drawtext filters
	if (captionTrack?.enabled && captionTrack.segments.length > 0) {
		const style = captionTrack.style;
		let captionX: string;
		switch (style.alignment) {
			case 'left': captionX = '(W*0.05)'; break;
			case 'right': captionX = '(W*0.95-tw)'; break;
			default: captionX = '(W/2-tw/2)';
		}
		let captionY: string;
		switch (style.position) {
			case 'top': captionY = '(H*0.1-th/2)'; break;
			case 'center': captionY = '(H/2-th/2)'; break;
			default: captionY = '(H*0.85-th/2)';
		}

		for (let i = 0; i < captionTrack.segments.length; i++) {
			const seg = captionTrack.segments[i];
			const nextLabel = `cap${i}`;
			const escapedText = seg.text.replace(/'/g, "\\'").replace(/:/g, '\\:');

			let drawtext = `drawtext=text='${escapedText}'`;
			drawtext += `:fontsize=${style.fontSize}`;
			drawtext += `:fontcolor=${style.fontColor}`;
			drawtext += `:font='${style.fontFamily}'`;
			drawtext += `:x=${captionX}:y=${captionY}`;
			drawtext += `:enable='between(t,${seg.startTime},${seg.endTime})'`;

			if (style.backgroundColor && style.backgroundColor !== 'transparent') {
				drawtext += `:box=1:boxcolor=${style.backgroundColor.replace(/,/g, '\\,')}:boxborderw=6`;
			}

			filterParts.push(`[${videoOut}]${drawtext}[${nextLabel}]`);
			videoOut = nextLabel;
		}
	}

	// Shape overlays — rendered as drawbox filters during FFmpeg export
	for (let i = 0; i < shapeOverlays.length; i++) {
		const shape = shapeOverlays[i];
		const nextLabel = `shp${i}`;
		const posX = Math.round((shape.x / 100) * width - shape.width / 2);
		const posY = Math.round((shape.y / 100) * height - shape.height / 2);
		const enable = `between(t\\,${shape.startTime}\\,${shape.startTime + shape.duration})`;

		const fillHex = shape.fillColor.replace('#', '0x');
		const alphaHex = Math.round(shape.opacity * 255).toString(16).padStart(2, '0');
		const color = `${fillHex}${alphaHex}`;

		let drawbox = `drawbox=x=${posX}:y=${posY}:w=${shape.width}:h=${shape.height}`;
		drawbox += `:color=${color}:t=fill`;
		drawbox += `:enable='${enable}'`;

		filterParts.push(`[${videoOut}]${drawbox}[${nextLabel}]`);
		videoOut = nextLabel;

		if (shape.strokeWidth > 0) {
			const strokeLabel = `shps${i}`;
			const strokeHex = shape.strokeColor.replace('#', '0x');
			let strokeBox = `drawbox=x=${posX}:y=${posY}:w=${shape.width}:h=${shape.height}`;
			strokeBox += `:color=${strokeHex}${alphaHex}:t=${Math.round(shape.strokeWidth)}`;
			strokeBox += `:enable='${enable}'`;
			filterParts.push(`[${videoOut}]${strokeBox}[${strokeLabel}]`);
			videoOut = strokeLabel;
		}
	}

	// Drawings composite above everything else, matching what the preview
	// shows: the annotation layer sits on top of the overlay canvas.
	const annotationOverlays = await buildAnnotationOverlays(annotations, width, height, {
		inputLabel: videoOut,
		firstInputIndex: inputPaths.length,
	});
	if (annotationOverlays.filters.length > 0) {
		for (const image of annotationOverlays.images) {
			await ffmpeg.writeFile(image.name, await image.blob.arrayBuffer());
		}
		args.push(...annotationOverlays.inputArgs);
		filterParts.push(...annotationOverlays.filters);
		videoOut = annotationOverlays.outputLabel;
	}

	// sendcmd opens these by name relative to the working directory, so they
	// have to exist before the graph is built.
	const encoder = new TextEncoder();
	for (const script of alphaScripts) {
		await ffmpeg.writeFile(script.filename, encoder.encode(script.content));
	}

	args.push('-filter_complex', filterParts.join(';'));
	args.push('-map', `[${videoOut}]`);
	args.push('-map', '[outa]');
	args.push('-c:v', config.videoCodec);
	args.push('-preset', tuning.preset);
	args.push('-c:a', config.audioCodec);

	if (config.videoBitrate > 0) {
		args.push('-b:v', `${config.videoBitrate}k`);
	}
	if (config.audioBitrate > 0) {
		args.push('-b:a', `${config.audioBitrate}k`);
	}

	args.push('-r', String(config.fps));
	args.push('-threads', tuning.threads);
	args.push('-movflags', '+faststart');
	args.push('-y', outputFile);

	progress('rendering', 0.2);

	const exitCode = await ffmpeg.exec(args, {
		onProgress: (p) => {
			progress('encoding', 0.2 + p * 0.7);
		},
	});

	if (exitCode !== 0) {
		await cleanup(ffmpeg, [...new Set(temps), outputFile]);
		throw new Error(`FFmpeg exited with code ${exitCode}. Check browser console for details.`);
	}

	progress('finalizing', 0.95);

	const result = await finishOutput(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...new Set(temps)]);
	if (!result.scratchName) await cleanup(ffmpeg, [outputFile]);
	return result;
}

// ── FFmpeg filter helpers for clip color correction ─────────────────

/**
 * Build FFmpeg video filter chain for clip color correction.
 * Maps clip filter values to FFmpeg eq/hue/boxblur filters.
 * Returns an array of filter strings to be chained, or empty if no filters needed.
 */
function buildFfmpegClipFilters(clip: Clip): string[] {
	if (!clip.filters || !hasNonDefaultFilters(clip.filters)) return [];

	const parts: string[] = [];
	const f = clip.filters;

	// eq filter for brightness (+ exposure offset), contrast, saturation
	const eqParts: string[] = [];
	// Exposure maps -100..100 to -0.5..0.5, added to base brightness
	const baseBrightness = (f.brightness / 100) - 1;
	const exposureOffset = f.exposure / 200;
	const totalBrightness = baseBrightness + exposureOffset;
	if (f.brightness !== DEFAULT_CLIP_FILTERS.brightness || f.exposure !== DEFAULT_CLIP_FILTERS.exposure) {
		eqParts.push(`brightness=${totalBrightness.toFixed(3)}`);
	}
	if (f.contrast !== DEFAULT_CLIP_FILTERS.contrast) {
		// FFmpeg eq contrast: 0.0 to 10.0 (1.0 = no change). Our 0-200 maps: v/100
		eqParts.push(`contrast=${(f.contrast / 100).toFixed(3)}`);
	}
	if (f.saturation !== DEFAULT_CLIP_FILTERS.saturation) {
		// FFmpeg eq saturation: 0.0 to 3.0 (1.0 = no change). Our 0-200 maps: v/100
		eqParts.push(`saturation=${(f.saturation / 100).toFixed(3)}`);
	}
	if (eqParts.length > 0) {
		parts.push(`eq=${eqParts.join(':')}`);
	}

	// hue filter
	if (f.hue !== DEFAULT_CLIP_FILTERS.hue) {
		parts.push(`hue=h=${f.hue}`);
	}

	// blur filter (boxblur)
	if (f.blur !== DEFAULT_CLIP_FILTERS.blur) {
		parts.push(`boxblur=${f.blur}:${f.blur}`);
	}

	// opacity via colorchannelmixer
	if (f.opacity !== DEFAULT_CLIP_FILTERS.opacity) {
		const a = (f.opacity / 100).toFixed(3);
		parts.push(`colorchannelmixer=aa=${a}`);
	}

	// Temperature: warm boosts reds, cool boosts blues via colorbalance
	if (f.temperature !== DEFAULT_CLIP_FILTERS.temperature) {
		const t = f.temperature;
		if (t > 0) {
			// Warm: boost red shadows/midtones/highlights, reduce blue
			const amount = (t / 100).toFixed(3);
			parts.push(`colorbalance=rs=${amount}:gs=0:bs=-${amount}:rm=${amount}:gm=0:bm=-${amount}:rh=${amount}:gh=0:bh=-${amount}`);
		} else {
			// Cool: boost blue shadows/midtones/highlights, reduce red
			const amount = (Math.abs(t) / 100).toFixed(3);
			parts.push(`colorbalance=rs=-${amount}:gs=0:bs=${amount}:rm=-${amount}:gm=0:bm=${amount}:rh=-${amount}:gh=0:bh=${amount}`);
		}
	}

	return parts;
}

// ── FFmpeg filter helpers for clip transforms ───────────────────────

function hasNonDefaultTransform(clip: Clip): boolean {
	const t = clip.transform;
	if (!t) return false;
	return t.rotation !== 0 || t.flipH || t.flipV;
}

function hasNonDefaultCrop(clip: Clip): boolean {
	const c = clip.crop;
	if (!c) return false;
	return c.top !== 0 || c.right !== 0 || c.bottom !== 0 || c.left !== 0;
}

/**
 * Build FFmpeg video filter chain for clip rotation and flip.
 * - 90 CW:  transpose=1
 * - 90 CCW: transpose=2
 * - 180:    transpose=1,transpose=1
 * - Flip H: hflip
 * - Flip V: vflip
 */
function buildFfmpegTransformFilters(clip: Clip): string[] {
	if (!hasNonDefaultTransform(clip)) return [];

	const parts: string[] = [];
	const t = clip.transform;

	// Rotation
	if (t.rotation === 90) {
		parts.push('transpose=1');
	} else if (t.rotation === 180) {
		parts.push('transpose=1,transpose=1');
	} else if (t.rotation === 270) {
		parts.push('transpose=2');
	}

	// Flip
	if (t.flipH) {
		parts.push('hflip');
	}
	if (t.flipV) {
		parts.push('vflip');
	}

	return parts;
}

/**
 * Build FFmpeg crop filter from clip crop percentages.
 * crop=out_w:out_h:x:y where values are calculated from source dimensions.
 * Uses iw/ih expressions so FFmpeg calculates at runtime.
 */
function buildFfmpegCropFilter(clip: Clip): string | null {
	if (!hasNonDefaultCrop(clip)) return null;

	const c = clip.crop;
	const left = c.left / 100;
	const right = c.right / 100;
	const top = c.top / 100;
	const bottom = c.bottom / 100;

	// out_w = iw * (1 - left - right), out_h = ih * (1 - top - bottom)
	// x = iw * left, y = ih * top
	const w = `iw*${(1 - left - right).toFixed(4)}`;
	const h = `ih*${(1 - top - bottom).toFixed(4)}`;
	const x = `iw*${left.toFixed(4)}`;
	const y = `ih*${top.toFixed(4)}`;

	return `crop=${w}:${h}:${x}:${y}`;
}

// ── FFmpeg filter helpers for chroma key ─────────────────────────────

/**
 * Build FFmpeg chromakey filter string from clip chroma key settings.
 * Returns the filter string or null if chroma key is not enabled.
 */
function buildFfmpegChromaKeyFilter(clip: Clip): string | null {
	if (!clip.chromaKey?.enabled) return null;

	const ck = clip.chromaKey;
	const hexColor = chromaColorToFFmpegHex(ck.color);
	// FFmpeg chromakey similarity: 0.01 (exact) to 1.0 (loose). Our threshold maps directly.
	const similarity = ck.threshold.toFixed(3);
	// FFmpeg chromakey blend: 0.0 (hard) to 1.0 (soft). Our smoothing maps directly.
	const blend = ck.smoothing.toFixed(3);

	return `chromakey=color=${hexColor}:similarity=${similarity}:blend=${blend}`;
}


// ── FFmpeg filter helpers for audio effects ──────────────────────────

/**
 * Build FFmpeg audio filter chain for a clip.
 * Handles: volume, fades, noise suppression, speed (atempo), reverse.
 */
function buildFfmpegAudioFilters(clip: Clip, gains?: LoudnessGains): string[] {
	const parts: string[] = [];

	// Volume
	const vol = clip.muted ? 0 : clip.volume;
	parts.push(`volume=${vol}`);

	// Loudness match, before anything that shapes the signal, so fades and
	// suppression act on the corrected level.
	const gain = gains?.get(clip.id);
	if (gain !== undefined) {
		const filter = gainFilter(gain);
		if (filter) parts.push(filter);
	}

	// Noise suppression: highpass + lowpass
	if (clip.noiseSuppression) {
		parts.push('highpass=f=200');
		parts.push('lowpass=f=8000');
	}

	// Fade in
	const fadeIn = clip.fadeIn ?? 0;
	if (fadeIn > 0) {
		parts.push(`afade=t=in:st=0:d=${fadeIn}`);
	}

	// Fade out
	const fadeOut = clip.fadeOut ?? 0;
	if (fadeOut > 0) {
		const fadeOutStart = clip.duration - fadeOut;
		parts.push(`afade=t=out:st=${Math.max(0, fadeOutStart).toFixed(3)}:d=${fadeOut}`);
	}

	// Speed via atempo chain (atempo only accepts 0.5-2.0)
	if (clip.speed !== 1) {
		const atempoFilters = buildAtempoChain(clip.speed);
		parts.push(...atempoFilters);
	}

	// Reverse
	if (clip.reversed) {
		parts.push('areverse');
	}

	return parts;
}

/**
 * Build a chain of atempo filters for the given speed.
 * FFmpeg atempo only accepts values in [0.5, 2.0], so we chain
 * multiple filters to achieve extreme speeds.
 * e.g. 4x = atempo=2.0,atempo=2.0
 * e.g. 0.25x = atempo=0.5,atempo=0.5
 */
function buildAtempoChain(speed: number): string[] {
	const parts: string[] = [];
	let remaining = speed;

	if (remaining > 1) {
		while (remaining > 2.0) {
			parts.push('atempo=2.0');
			remaining /= 2.0;
		}
		if (Math.abs(remaining - 1.0) > 0.001) {
			parts.push(`atempo=${remaining.toFixed(4)}`);
		}
	} else if (remaining < 1) {
		while (remaining < 0.5) {
			parts.push('atempo=0.5');
			remaining /= 0.5;
		}
		if (Math.abs(remaining - 1.0) > 0.001) {
			parts.push(`atempo=${remaining.toFixed(4)}`);
		}
	}

	return parts;
}

/**
 * Build FFmpeg setpts expression for video speed change.
 * e.g. speed 2 = setpts=0.5*PTS, speed 0.5 = setpts=2*PTS
 */
function buildSpeedVideoFilter(speed: number): string | null {
	if (speed === 1) return null;
	return `setpts=${(1 / speed).toFixed(4)}*PTS`;
}

// ── FFmpeg filter helpers for PiP position ──────────────────────────

/**
 * Build FFmpeg filter for PiP positioning.
 * Scales the clip to the desired percentage of the target resolution,
 * then pads it onto a full-size canvas at the correct position.
 */
function buildFfmpegPositionFilter(clip: Clip, targetWidth: number, targetHeight: number): string | null {
	const pos = clip.position ?? DEFAULT_CLIP_POSITION;
	if (!hasNonDefaultPosition(pos)) return null;

	const pipW = Math.round(targetWidth * pos.width / 100);
	const pipH = Math.round(targetHeight * pos.height / 100);
	const pipX = Math.round(targetWidth * pos.x / 100);
	const pipY = Math.round(targetHeight * pos.y / 100);

	// Scale clip to PiP size, then pad onto a full-size canvas at the correct offset
	return `scale=${pipW}:${pipH}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:${pipX}:${pipY}:color=black@0`;
}

// ── Shared helpers ──────────────────────────────────────────────────

/**
 * Rejects an input the engine genuinely cannot process.
 *
 * The limit belongs to the engine, not to the pipeline. ffmpeg.wasm decodes
 * inside a bounded heap; the native binary does not, and hard-coding the wasm
 * ceiling here made the desktop refuse a 474MB source it could have exported
 * without trouble.
 */
function validateFileSize(ffmpeg: FFmpegEngine, bytes: number): void {
	const limit = ffmpeg.maxInputBytes;
	if (limit === null || bytes <= limit) return;

	const mb = (n: number) => Math.round(n / (1024 * 1024));
	throw new Error(
		`File is too large (${mb(bytes)}MB). ` +
		`This build processes video in the browser and can handle files up to ` +
		`~${mb(limit)}MB. Trim the clip shorter, or use the desktop app, which ` +
		`has no such limit.`
	);
}

/**
 * Encoder settings that depend on where ffmpeg is running.
 *
 * `ultrafast` and a single thread were chosen to keep ffmpeg.wasm inside its
 * heap, and that reasoning does not apply to a native binary — it just made 4K
 * exports both slow and blocky. The wasm path keeps the old numbers because
 * the constraint there is real.
 */
function encoderTuning(ffmpeg: FFmpegEngine): { preset: string; threads: string } {
	return ffmpeg.persistentStore
		? { preset: 'medium', threads: '0' }
		: { preset: 'ultrafast', threads: '1' };
}

export interface PreparedInput {
	/** The virtual filename to hand ffmpeg. */
	path: string;
	/** False when the bytes were already on disk and must be left there. */
	disposable: boolean;
}

/**
 * Makes an asset's bytes available to ffmpeg under a virtual filename.
 *
 * Import already streams every file into the native scratch directory to feed
 * the preview, so on the desktop the bytes are on disk before an export
 * starts. Reusing that staging is not just an optimisation: the fallback path
 * calls `file.arrayBuffer()`, which materialises the whole source in webview
 * memory — half a gigabyte for a long 1080p clip, on a heap that has already
 * been seen to die at that size.
 */
async function prepareInput(
	ffmpeg: FFmpegEngine,
	asset: { file: File; name: string; scratchName?: string },
	fallbackPath: string
): Promise<PreparedInput> {
	if (asset.scratchName && ffmpeg.fileExists) {
		// A staged file can go missing — the scratch directory is emptied on
		// launch — so confirm rather than assume.
		if (await ffmpeg.fileExists(asset.scratchName)) {
			return { path: asset.scratchName, disposable: false };
		}
	}

	validateFileSize(ffmpeg, asset.file.size);
	await writeAssetFile(ffmpeg, fallbackPath, asset.file);
	return { path: fallbackPath, disposable: true };
}

function getExt(filename: string): string {
	return filename.split('.').pop()?.toLowerCase() || 'mp4';
}

async function writeAssetFile(ffmpeg: FFmpegEngine, path: string, file: File): Promise<void> {
	const arrayBuffer = await file.arrayBuffer();
	await ffmpeg.writeFile(path, arrayBuffer);
}

const MIME_MAP: Record<string, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
	mkv: 'video/x-matroska',
	avi: 'video/x-msvideo',
	mov: 'video/quicktime',
};

async function readOutputBlob(ffmpeg: FFmpegEngine, outputFile: string, format: string): Promise<Blob> {
	const outputData = await ffmpeg.readFile(outputFile);
	return new Blob([outputData], { type: MIME_MAP[format] ?? 'video/mp4' });
}

/**
 * Hands back the finished render in whichever form costs least.
 *
 * On an engine with real storage the file stays where ffmpeg wrote it and only
 * its name travels; the save step copies it natively. Pulling it into a Blob
 * first would put the entire output — commonly hundreds of megabytes — into
 * the webview heap, and then `saveOutput` would copy it a second time.
 */
async function finishOutput(
	ffmpeg: FFmpegEngine,
	outputPath: string,
	format: string
): Promise<ExportResult> {
	if (ffmpeg.persistentStore) {
		const size = await outputSizeOf(ffmpeg, outputPath);
		return { blob: null, scratchName: outputPath, size };
	}
	const blob = await readOutputBlob(ffmpeg, outputPath, format);
	return { blob, scratchName: null, size: blob.size };
}

/** Best-effort size for progress reporting; never worth failing an export over. */
async function outputSizeOf(ffmpeg: FFmpegEngine, path: string): Promise<number> {
	try {
		return (await ffmpeg.fileSize?.(path)) ?? 0;
	} catch {
		return 0;
	}
}

async function cleanup(ffmpeg: FFmpegEngine, paths: string[]): Promise<void> {
	for (const path of paths) {
		try { await ffmpeg.deleteFile(path); } catch {}
	}
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
