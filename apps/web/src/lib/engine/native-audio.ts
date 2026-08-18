import type { FFmpegEngine } from './ffmpeg-engine.js';

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
 * Cost: a decoded AudioBuffer holds the whole clip in RAM (~40MB per minute
 * of stereo). Buffers are cached per asset with a small LRU so switching
 * between a few clips doesn't re-extract each time.
 */

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext {
	sharedContext ??= new AudioContext();
	return sharedContext;
}

const cache = new Map<string, AudioBuffer>();
const MAX_CACHED_ASSETS = 3;
const pending = new Map<string, Promise<AudioBuffer | null>>();

/**
 * Decodes a scratch file's audio track into an AudioBuffer, cached per asset.
 * Returns null for silent video or when extraction fails — a preview without
 * sound beats a preview that throws.
 */
export function loadClipAudio(
	engine: FFmpegEngine,
	assetId: string,
	scratchName: string
): Promise<AudioBuffer | null> {
	const hit = cache.get(assetId);
	if (hit) return Promise.resolve(hit);

	// A second caller while extraction runs must share the same work.
	const inFlight = pending.get(assetId);
	if (inFlight) return inFlight;

	const work = (async (): Promise<AudioBuffer | null> => {
		const wavName = `paudio_${assetId}.wav`;
		try {
			const exitCode = await engine.exec([
				'-i', scratchName,
				'-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le',
				wavName,
			]);
			if (exitCode !== 0) return null;

			const bytes = await engine.readFile(wavName);
			await engine.deleteFile(wavName).catch(() => {});

			const buffer = await audioContext().decodeAudioData(bytes);

			cache.set(assetId, buffer);
			while (cache.size > MAX_CACHED_ASSETS) {
				const oldest = cache.keys().next().value;
				if (oldest === undefined) break;
				cache.delete(oldest);
			}
			return buffer;
		} catch (error) {
			console.warn('[native-audio] extraction failed, preview will be silent:', error);
			return null;
		} finally {
			pending.delete(assetId);
		}
	})();

	pending.set(assetId, work);
	return work;
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
