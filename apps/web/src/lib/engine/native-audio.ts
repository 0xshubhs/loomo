import type { FFmpegEngine } from './ffmpeg-engine.js';
import { windowKey } from '$lib/playback/audio-windows.js';

/**
 * Preview audio decoded by the bundled ffmpeg and played through Web Audio.
 *
 * The last job the webview's media element held was audio, and it lost that
 * one too: on this hardware the element intermittently wedges at readyState 0
 * — `play()` neither resolves nor rejects — so sound simply never starts.
 * Extracting PCM with ffmpeg and playing it via an AudioBuffer sidesteps the
 * media pipeline entirely; `decodeAudioData` on a WAV is a trivial header
 * parse, not a GStreamer pipeline.
 *
 * Audio is extracted a window at a time, never whole. Decoding a whole clip
 * did not survive contact with a real file: a 50-minute source produced a
 * 536 MB WAV, which was read back through the IPC in one piece and expanded by
 * `decodeAudioData` into a 1.07 GB float buffer. Peak was about 2.5 GB for one
 * clip, the cache held three, and the app was OOM-killed with the status line
 * still reading "Extracting audio".
 */

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext {
	sharedContext ??= new AudioContext();
	return sharedContext;
}

const cache = new Map<string, AudioBuffer>();
/**
 * Windows held at once, across every asset.
 *
 * Four is the current and next window for two clips — enough to cross a cut
 * without a gap, and about 40 MB rather than the gigabytes the old whole-clip
 * cache reached.
 */
const MAX_CACHED_WINDOWS = 4;
const pending = new Map<string, Promise<AudioBuffer | null>>();

/**
 * Decodes one window of a scratch file's audio into an AudioBuffer.
 *
 * `-ss` goes *after* `-i`, which is the slow, accurate form. The fast form
 * seeks the input to the nearest packet boundary before the target, and
 * measured against this file it landed somewhere else entirely — 23368 of
 * 32000 bytes differed. The usual hybrid (`-ss near -i file -ss remainder`)
 * is no better, because it adds a fixed offset to an input seek that was
 * already inexact.
 *
 * Accurate seeking costs about 0.5ms per second of source: 0.7s at twenty
 * minutes in, 1.6s at fifty. That is why windows are fetched well ahead.
 * Measured: consecutive windows extracted this way join sample-exactly, so
 * there is no gap or drift at a boundary.
 *
 * Returns null for silent video or when extraction fails: a preview without
 * sound beats a preview that throws.
 */
export function loadAudioWindow(
	engine: FFmpegEngine,
	assetId: string,
	scratchName: string,
	startSeconds: number,
	seconds: number
): Promise<AudioBuffer | null> {
	const index = Math.round(startSeconds / Math.max(1, seconds));
	const key = windowKey(assetId, index);

	const hit = cache.get(key);
	if (hit) return Promise.resolve(hit);

	// A second caller while extraction runs must share the same work.
	const inFlight = pending.get(key);
	if (inFlight) return inFlight;

	const work = (async (): Promise<AudioBuffer | null> => {
		// The window index is in the name so two windows of the same asset
		// cannot overwrite each other mid-extraction.
		const wavName = `paudio_${assetId}_${index}.wav`;
		try {
			const exitCode = await engine.exec([
				'-i', scratchName,
				'-ss', String(startSeconds),
				'-t', String(seconds),
				'-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le',
				wavName,
			]);
			if (exitCode !== 0) return null;

			const bytes = await engine.readFile(wavName);
			await engine.deleteFile(wavName).catch(() => {});
			// A window past the end of the audio decodes to nothing.
			if (bytes.byteLength === 0) return null;

			const buffer = await audioContext().decodeAudioData(bytes);
			cache.set(key, buffer);
			evictOldWindows();
			return buffer;
		} catch (error) {
			console.warn('[native-audio] extraction failed, preview will be silent:', error);
			return null;
		} finally {
			pending.delete(key);
		}
	})();

	pending.set(key, work);
	return work;
}

/** Drops the oldest windows once the cache is over its bound. */
function evictOldWindows(): void {
	while (cache.size > MAX_CACHED_WINDOWS) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

/**
 * Releases every cached window.
 *
 * Called when the editor is torn down: an AudioBuffer is not small, and
 * holding them past the session is how the process grows without ever
 * appearing to leak.
 */
export function clearAudioCache(): void {
	cache.clear();
	pending.clear();
}

/** Plays one clip's AudioBuffer from an offset, with live volume control. */
export class NativeAudioPlayer {
	#source: AudioBufferSourceNode | null = null;
	#gain: GainNode | null = null;
	#startedAtContextTime = 0;
	#startOffset = 0;
	#rate = 1;
	#playing = false;

	get playing(): boolean {
		return this.#playing;
	}

	/**
	 * Where playback has reached in the source, in seconds.
	 *
	 * Web Audio runs on its own clock, so this is derived from the context
	 * time rather than tracked by hand — the caller compares it against the
	 * timeline clock to detect drift.
	 */
	position(): number {
		if (!this.#playing) return this.#startOffset;
		const elapsed = audioContext().currentTime - this.#startedAtContextTime;
		return this.#startOffset + elapsed * this.#rate;
	}

	start(buffer: AudioBuffer, offsetSeconds: number, rate: number, volume: number): void {
		this.stop();
		const ctx = audioContext();
		// Autoplay policy can leave a fresh context suspended; resuming inside
		// the user's play gesture is allowed.
		if (ctx.state === 'suspended') void ctx.resume();

		this.#gain = ctx.createGain();
		this.#gain.gain.value = Math.max(0, volume);
		this.#gain.connect(ctx.destination);

		this.#source = ctx.createBufferSource();
		this.#source.buffer = buffer;
		this.#source.playbackRate.value = Math.max(0.1, rate);
		this.#source.connect(this.#gain);

		const offset = Math.max(0, Math.min(offsetSeconds, Math.max(0, buffer.duration - 0.01)));
		this.#startOffset = offset;
		this.#rate = Math.max(0.1, rate);
		this.#startedAtContextTime = ctx.currentTime;
		this.#playing = true;
		this.#source.onended = () => {
			this.#playing = false;
		};
		this.#source.start(0, offset);
	}

	setVolume(volume: number): void {
		if (this.#gain) this.#gain.gain.value = Math.max(0, volume);
	}

	stop(): void {
		try {
			this.#source?.stop();
		} catch {
			/* already stopped */
		}
		this.#source?.disconnect();
		this.#gain?.disconnect();
		this.#source = null;
		this.#gain = null;
		this.#playing = false;
	}
}
