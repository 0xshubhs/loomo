import type { CaptionSegment } from '$lib/types/index.js';
import type { FFmpegEngine } from './ffmpeg-engine.js';
import { transcribeAudio } from './speech-recognition.js';
import {
	TRANSCRIBE_OVERLAP_SECONDS,
	TRANSCRIBE_WINDOW_SECONDS,
	stitchWindow,
	transcriptionWindows,
	type TranscriptionWindow,
} from './transcription-windows.js';

/**
 * Auto-captions for files too large to bring into the page.
 *
 * `assetBlob` refuses anything over 400 MB, because reading a scratch copy
 * costs a copy in Rust, one in transit and one in the page — a 978 MB source is
 * three gigabytes before anything has decoded, and that OOM-killed the app.
 * Captions therefore did not work on the recordings people actually make.
 *
 * So the audio is extracted a window at a time and each window is transcribed
 * on its own, exactly as preview audio is decoded a window at a time. Peak
 * memory is one window — a few megabytes — however long the recording is.
 */

/** The signature of `transcribeAudio`; injected so the loop can be tested. */
export type WindowTranscriber = (
	audio: Blob,
	language: string,
	onProgress?: (status: string) => void,
	abortSignal?: AbortSignal
) => Promise<CaptionSegment[]>;

/** The message the dialog treats as a deliberate stop rather than a failure. */
export const CANCELLED_MESSAGE = 'Transcription cancelled';

export interface WindowedTranscriptionOptions {
	engine: FFmpegEngine;
	/** The asset's file in the scratch directory, never read whole. */
	scratchName: string;
	/** Only used to name temporary files, so two assets cannot collide. */
	assetId: string;
	durationSeconds: number;
	language?: string;
	onProgress?: (status: string) => void;
	abortSignal?: AbortSignal;
	transcribe?: WindowTranscriber;
	windowSeconds?: number;
	overlapSeconds?: number;
}

/**
 * Transcribes a whole file without ever holding more than one window of it.
 *
 * Every window's segments are moved into source time and joined to the
 * transcript by `stitchWindow`, which also removes the speech the windows
 * overlap deliberately heard twice.
 */
export async function transcribeInWindows(
	options: WindowedTranscriptionOptions
): Promise<CaptionSegment[]> {
	const {
		engine,
		scratchName,
		assetId,
		durationSeconds,
		language = 'en-US',
		onProgress,
		abortSignal,
		transcribe = transcribeAudio,
		windowSeconds = TRANSCRIBE_WINDOW_SECONDS,
		overlapSeconds = TRANSCRIBE_OVERLAP_SECONDS,
	} = options;

	const windows = transcriptionWindows(durationSeconds, windowSeconds, overlapSeconds);
	if (windows.length === 0) {
		throw new Error('This media has no known duration, so it cannot be transcribed in parts.');
	}

	let segments: CaptionSegment[] = [];

	for (const window of windows) {
		throwIfAborted(abortSignal);

		const part = `part ${window.index + 1} of ${windows.length}`;
		onProgress?.(`Extracting audio for ${part}...`);

		const audio = await extractWindowAudio(engine, assetId, scratchName, window);
		throwIfAborted(abortSignal);

		// One window that will not decode should not throw away the forty
		// minutes already transcribed; the gap is a stretch without captions.
		if (!audio) {
			console.warn(`[captions] no audio extracted for ${part}, continuing without it`);
			continue;
		}

		const heard = await transcribe(
			audio,
			language,
			(status) => onProgress?.(`${capitalize(part)}: ${status}`),
			abortSignal
		);

		segments = stitchWindow(segments, heard, window.start, overlapSeconds);
		onProgress?.(`Finished ${part} — ${segments.length} segments so far`);
	}

	return segments;
}

/**
 * Pulls one window out of the source as a WAV blob.
 *
 * `-ss` goes *after* `-i`, the slow accurate form. The fast form seeks to the
 * nearest packet boundary before the target and, measured against a real file,
 * landed somewhere else entirely — which here would offset every caption in the
 * window by an unknown amount.
 *
 * 16 kHz mono is what speech recognition uses internally, and it keeps a
 * five-minute window near 10 MB rather than the 50 MB that 44.1 kHz stereo
 * would cost to cross the IPC for no gain in accuracy.
 *
 * Returns null when the window has no audio — silent video, or a window past
 * the end — because a gap in the captions beats losing the whole run.
 */
async function extractWindowAudio(
	engine: FFmpegEngine,
	assetId: string,
	scratchName: string,
	window: TranscriptionWindow
): Promise<Blob | null> {
	// The window index is in the name so a retry or a second asset cannot
	// overwrite a file that is still being read.
	const wavName = `caption_${assetId}_${window.index}.wav`;

	try {
		const exitCode = await engine.exec([
			'-i', scratchName,
			'-ss', String(window.start),
			'-t', String(window.duration),
			'-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
			wavName,
		]);
		if (exitCode !== 0) return null;

		const bytes = await engine.readFile(wavName);
		if (bytes.byteLength === 0) return null;

		return new Blob([bytes], { type: 'audio/wav' });
	} catch (error) {
		console.warn('[captions] window extraction failed:', error);
		return null;
	} finally {
		// Scratch files outlive the session otherwise, and a 50-minute file is
		// ten of them.
		await engine.deleteFile(wavName).catch(() => {});
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
