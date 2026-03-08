import type { ExportConfig, ExportProgress } from '$lib/types/index.js';
import type { Track, Clip } from '$lib/types/index.js';
import type { Transition, TextOverlay } from '$lib/types/index.js';
import type { FFmpegBridge } from './ffmpeg-bridge.svelte.js';
import { RESOLUTION_MAP } from '$lib/types/export.js';

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
	ffmpeg: FFmpegBridge,
	tracks: Track[],
	transitions: Transition[],
	textOverlays: TextOverlay[],
	config: ExportConfig,
	onProgress: (progress: ExportProgress) => void,
	getAssetFile: (assetId: string) => { file: File; name: string } | undefined
): Promise<Blob> {
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
	const hasEffects = textOverlays.length > 0 || transitions.length > 0;
	const outputFile = `output.${config.format}`;

	const targetRes = RESOLUTION_MAP[config.resolution];
	const targetWidth = config.customWidth ?? targetRes.width;
	const targetHeight = config.customHeight ?? targetRes.height;

	// Probe source resolution to decide if scaling is needed
	let needsScale = false;
	if (!hasEffects) {
		const firstAsset = getAssetFile(sortedClips[0].assetId);
		if (firstAsset) {
			const sourceRes = await probeVideoResolution(firstAsset.file);
			if (sourceRes.width > 0 && sourceRes.height > 0) {
				needsScale = sourceRes.width !== targetWidth || sourceRes.height !== targetHeight;
			}
		}
	}

	let blob: Blob;

	if (hasEffects) {
		// Strategy C: filter_complex — text overlays or transitions need all clips
		blob = await exportFilterComplex(
			ffmpeg, sortedClips, textOverlays, config, targetWidth, targetHeight, outputFile, getAssetFile, progress
		);
	} else if (!needsScale && sortedClips.length === 1) {
		// Strategy A: Single clip, source resolution — stream copy
		blob = await exportSingleClipStreamCopy(ffmpeg, sortedClips[0], config, outputFile, getAssetFile, progress);
	} else if (!needsScale) {
		// Strategy A: Multi-clip, source resolution — stream copy concat
		blob = await exportConcatStreamCopy(ffmpeg, sortedClips, config, outputFile, getAssetFile, progress);
	} else {
		// Strategy B: Resolution change (4K, downscale, etc.) — re-encode per-clip + concat
		blob = await exportReencodeConcat(
			ffmpeg, sortedClips, config, targetWidth, targetHeight, outputFile, getAssetFile, progress
		);
	}

	onProgress({
		stage: 'done',
		progress: 1,
		currentFrame: 0,
		totalFrames: 0,
		elapsed: Date.now() - startTime,
		eta: 0,
		outputSize: blob.size,
	});

	return blob;
}

// ── Probe source resolution (no WASM needed) ───────────────────────

function probeVideoResolution(file: File): Promise<{ width: number; height: number }> {
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

// ── Strategy A1: Single clip stream copy ────────────────────────────

async function exportSingleClipStreamCopy(
	ffmpeg: FFmpegBridge,
	clip: Clip,
	config: ExportConfig,
	outputFile: string,
	getAssetFile: (id: string) => { file: File; name: string } | undefined,
	progress: (stage: ExportProgress['stage'], p: number) => void
): Promise<Blob> {
	const asset = getAssetFile(clip.assetId);
	if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

	validateFileSize(asset.file.size);

	const ext = getExt(asset.name);
	const inputPath = `input.${ext}`;

	progress('preparing', 0.1);
	await writeAssetFile(ffmpeg, inputPath, asset.file);

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
		await cleanup(ffmpeg, [inputPath, outputFile]);
		throw new Error(`FFmpeg exited with code ${exitCode}`);
	}

	progress('finalizing', 0.9);
	const blob = await readOutputBlob(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [inputPath, outputFile]);
	return blob;
}

// ── Strategy A2: Multi-clip concat with stream copy ─────────────────

async function exportConcatStreamCopy(
	ffmpeg: FFmpegBridge,
	sortedClips: Clip[],
	config: ExportConfig,
	outputFile: string,
	getAssetFile: (id: string) => { file: File; name: string } | undefined,
	progress: (stage: ExportProgress['stage'], p: number) => void
): Promise<Blob> {
	const trimmedFiles: string[] = [];
	const total = sortedClips.length;

	for (let i = 0; i < total; i++) {
		const clip = sortedClips[i];
		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		validateFileSize(asset.file.size);

		const ext = getExt(asset.name);
		const inputPath = `src_${i}.${ext}`;
		const trimmedPath = `trimmed_${i}.mp4`;

		progress('preparing', (i / total) * 0.4);

		await writeAssetFile(ffmpeg, inputPath, asset.file);

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
			await cleanup(ffmpeg, [inputPath, trimmedPath, ...trimmedFiles, outputFile]);
			throw new Error(`FFmpeg trim failed for clip ${i + 1} (exit code ${exitCode})`);
		}

		try { await ffmpeg.deleteFile(inputPath); } catch {}
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
	const blob = await readOutputBlob(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...trimmedFiles, listPath, outputFile]);
	return blob;
}

// ── Strategy B: Re-encode per-clip + concat (4K, resolution change) ─
// Processes ONE source file at a time → keeps WASM memory low.
// Each clip is individually re-encoded to the target resolution,
// then all re-encoded clips are concatenated with stream copy.

async function exportReencodeConcat(
	ffmpeg: FFmpegBridge,
	sortedClips: Clip[],
	config: ExportConfig,
	width: number,
	height: number,
	outputFile: string,
	getAssetFile: (id: string) => { file: File; name: string } | undefined,
	progress: (stage: ExportProgress['stage'], p: number) => void
): Promise<Blob> {
	const encodedFiles: string[] = [];
	const total = sortedClips.length;

	for (let i = 0; i < total; i++) {
		const clip = sortedClips[i];
		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		validateFileSize(asset.file.size);

		const ext = getExt(asset.name);
		const inputPath = `src_${i}.${ext}`;
		const encodedPath = `enc_${i}.mp4`;

		progress('preparing', (i / total) * 0.3);
		await writeAssetFile(ffmpeg, inputPath, asset.file);

		progress('encoding', 0.3 + (i / total) * 0.5);

		const args: string[] = [];
		if (clip.sourceStart > 0.01) {
			args.push('-ss', String(clip.sourceStart));
		}
		args.push('-i', inputPath);
		args.push('-t', String(clip.duration));

		// Scale to target resolution with letterbox padding
		args.push(
			'-vf',
			`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
		);

		args.push('-c:v', config.videoCodec);
		args.push('-preset', 'ultrafast'); // Minimize memory + speed
		args.push('-c:a', config.audioCodec);

		if (config.videoBitrate > 0) {
			args.push('-b:v', `${config.videoBitrate}k`);
		}
		if (config.audioBitrate > 0) {
			args.push('-b:a', `${config.audioBitrate}k`);
		}

		args.push('-r', String(config.fps));
		args.push('-threads', '1'); // Minimize peak memory
		args.push('-movflags', '+faststart');
		args.push('-y', encodedPath);

		const exitCode = await ffmpeg.exec(args, {
			onProgress: (p) => {
				progress('encoding', 0.3 + ((i + p) / total) * 0.5);
			},
		});

		if (exitCode !== 0) {
			await cleanup(ffmpeg, [inputPath, encodedPath, ...encodedFiles, outputFile]);
			throw new Error(`FFmpeg re-encode failed for clip ${i + 1} (exit code ${exitCode})`);
		}

		// Free source file immediately to reclaim WASM memory
		try { await ffmpeg.deleteFile(inputPath); } catch {}
		encodedFiles.push(encodedPath);
	}

	// Single encoded clip — just read it directly
	if (encodedFiles.length === 1) {
		progress('finalizing', 0.9);
		const blob = await readOutputBlob(ffmpeg, encodedFiles[0], config.format);
		await cleanup(ffmpeg, encodedFiles);
		return blob;
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
	const blob = await readOutputBlob(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...encodedFiles, listPath, outputFile]);
	return blob;
}

// ── Strategy C: filter_complex for effects ──────────────────────────

async function exportFilterComplex(
	ffmpeg: FFmpegBridge,
	sortedClips: Clip[],
	textOverlays: TextOverlay[],
	config: ExportConfig,
	width: number,
	height: number,
	outputFile: string,
	getAssetFile: (id: string) => { file: File; name: string } | undefined,
	progress: (stage: ExportProgress['stage'], p: number) => void
): Promise<Blob> {
	// Write all source files (dedup by assetId)
	const inputPaths: string[] = [];
	const writtenAssets = new Map<string, string>();

	for (let i = 0; i < sortedClips.length; i++) {
		const clip = sortedClips[i];

		if (writtenAssets.has(clip.assetId)) {
			inputPaths.push(writtenAssets.get(clip.assetId)!);
			continue;
		}

		const asset = getAssetFile(clip.assetId);
		if (!asset) throw new Error(`Asset not found for clip "${clip.name}"`);

		validateFileSize(asset.file.size);

		const ext = getExt(asset.name);
		const inputPath = `input_${i}.${ext}`;

		progress('preparing', 0.05 + (i / sortedClips.length) * 0.15);
		await writeAssetFile(ffmpeg, inputPath, asset.file);

		writtenAssets.set(clip.assetId, inputPath);
		inputPaths.push(inputPath);
	}

	// Build filter_complex args
	const args: string[] = [];

	for (const path of inputPaths) {
		args.push('-i', path);
	}

	const filterParts: string[] = [];

	for (let i = 0; i < sortedClips.length; i++) {
		const clip = sortedClips[i];
		const vLabel = `v${i}`;
		const aLabel = `a${i}`;

		filterParts.push(
			`[${i}:v]trim=start=${clip.sourceStart}:duration=${clip.duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[${vLabel}]`
		);

		const vol = clip.muted ? 0 : clip.volume;
		filterParts.push(
			`[${i}:a]atrim=start=${clip.sourceStart}:duration=${clip.duration},asetpts=PTS-STARTPTS,volume=${vol}[${aLabel}]`
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
		filterParts.push(
			`[${videoOut}]drawtext=text='${escapedText}':fontsize=${t.fontSize}:fontcolor=${t.color}:x=(W*${t.x}-tw/2):y=(H*${t.y}-th/2):enable='between(t,${t.timelineStart},${t.timelineStart + t.duration})'[${nextLabel}]`
		);
		videoOut = nextLabel;
	}

	args.push('-filter_complex', filterParts.join(';'));
	args.push('-map', `[${videoOut}]`);
	args.push('-map', '[outa]');
	args.push('-c:v', config.videoCodec);
	args.push('-preset', 'ultrafast'); // Memory-efficient
	args.push('-c:a', config.audioCodec);

	if (config.videoBitrate > 0) {
		args.push('-b:v', `${config.videoBitrate}k`);
	}
	if (config.audioBitrate > 0) {
		args.push('-b:a', `${config.audioBitrate}k`);
	}

	args.push('-r', String(config.fps));
	args.push('-threads', '1'); // Minimize peak memory
	args.push('-movflags', '+faststart');
	args.push('-y', outputFile);

	progress('rendering', 0.2);

	const exitCode = await ffmpeg.exec(args, {
		onProgress: (p) => {
			progress('encoding', 0.2 + p * 0.7);
		},
	});

	if (exitCode !== 0) {
		const allPaths = [...new Set(inputPaths), outputFile];
		await cleanup(ffmpeg, allPaths);
		throw new Error(`FFmpeg exited with code ${exitCode}. Check browser console for details.`);
	}

	progress('finalizing', 0.95);

	const blob = await readOutputBlob(ffmpeg, outputFile, config.format);
	await cleanup(ffmpeg, [...new Set(inputPaths), outputFile]);
	return blob;
}

// ── Shared helpers ──────────────────────────────────────────────────

/** Max file size FFmpeg.wasm can handle (WASM memory limit ~512MB, need room for processing) */
const MAX_FILE_SIZE_MB = 300;

function validateFileSize(bytes: number): void {
	const mb = bytes / (1024 * 1024);
	if (mb > MAX_FILE_SIZE_MB) {
		throw new Error(
			`File is too large (${Math.round(mb)}MB). ` +
			`FFmpeg.wasm can handle files up to ~${MAX_FILE_SIZE_MB}MB. ` +
			`Try trimming the clip shorter before exporting.`
		);
	}
}

function getExt(filename: string): string {
	return filename.split('.').pop()?.toLowerCase() || 'mp4';
}

async function writeAssetFile(ffmpeg: FFmpegBridge, path: string, file: File): Promise<void> {
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

async function readOutputBlob(ffmpeg: FFmpegBridge, outputFile: string, format: string): Promise<Blob> {
	const outputData = await ffmpeg.readFile(outputFile);
	return new Blob([outputData], { type: MIME_MAP[format] ?? 'video/mp4' });
}

async function cleanup(ffmpeg: FFmpegBridge, paths: string[]): Promise<void> {
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
