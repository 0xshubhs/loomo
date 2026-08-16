import type { RecorderStore } from '$lib/state/recorder.svelte.js';
import type { RecordingResult } from '$lib/types/recorder.js';
import { QUALITY_MAP } from '$lib/types/recorder.js';
import {
	captureCapabilities,
	readCapture,
	startCapture,
	stopCapture,
	type CaptureCapabilities
} from '$lib/desktop/capture.js';
import { createFFmpegEngine } from '$lib/engine/ffmpeg-engine.js';

/**
 * Screen recording driven by the bundled ffmpeg rather than `MediaRecorder`.
 *
 * This exists because `getDisplayMedia` is unavailable or unreliable in the
 * system webviews Tauri uses — WebKitGTK most of all. Recording through ffmpeg
 * also encodes straight to H.264 on the way to disk, so a long session never
 * accumulates in memory the way a `MediaRecorder` chunk array does.
 *
 * Deliberately narrower than the browser session:
 *
 * - Handles screen capture only. Camera and audio-only modes go through
 *   `getUserMedia`, which webviews support perfectly well, so they keep using
 *   `RecordingSession`.
 * - No pause. ffmpeg has no pause; faking it means splitting into segments and
 *   concatenating, which would risk a dropped frame at every seam. `canPause`
 *   reports false so the UI can hide the control.
 */
export class NativeRecordingSession {
	readonly canPause = false;

	#store: RecorderStore;
	#timer: ReturnType<typeof setInterval> | null = null;
	#startedAt = 0;
	#outputName: string | null = null;

	constructor(store: RecorderStore) {
		this.#store = store;
	}

	/** Whether this session type can serve the recorder's current mode. */
	static async supports(mode: string): Promise<{ ok: boolean; capabilities: CaptureCapabilities }> {
		const capabilities = await captureCapabilities();
		return { ok: capabilities.available && mode === 'screen-only', capabilities };
	}

	async start(): Promise<void> {
		const { quality, selectedMicId, systemAudioEnabled } = this.#store;

		this.#store.startCountdown();
		await this.#countdown();

		try {
			// A frame rate, not a resolution: ffmpeg grabs the screen at its
			// native size, and the quality preset only picks how hard we encode.
			const { height } = QUALITY_MAP[quality];
			const crf = height >= 1080 ? 20 : height >= 720 ? 23 : 26;

			const started = await startCapture({
				fps: 30,
				crf,
				preset: 'veryfast',
				// The recorder's device ids come from `enumerateDevices` and mean
				// nothing to ffmpeg, so we ask for the system default input.
				audioDevice: systemAudioEnabled || selectedMicId ? 'default' : null,
				outputName: `capture-${Date.now()}.mp4`
			});

			this.#outputName = started.outputName;
			this.#store.startRecording();
			this.#startTimer();
		} catch (error) {
			this.#store.setError(`Recording failed: ${error}`);
			throw error;
		}
	}

	pause(): void {
		// Intentionally inert — see canPause.
	}

	resume(): void {
		// Intentionally inert — see canPause.
	}

	async stop(): Promise<RecordingResult> {
		if (!this.#outputName) throw new Error('No active recording');

		this.#stopTimer();
		this.#store.stopRecording();

		// Waits for ffmpeg to write the MP4 index; killing it here would leave
		// a file no player can open.
		const result = await stopCapture();
		const blob = await readCapture(result.outputName);
		const thumbnailUrl = await this.#thumbnail(result.outputName);

		const recording: RecordingResult = {
			blob,
			duration: result.duration,
			mimeType: 'video/mp4',
			thumbnailUrl
		};

		this.#store.setResult(recording);
		this.#outputName = null;
		return recording;
	}

	async cancel(): Promise<void> {
		this.#stopTimer();
		if (this.#outputName) {
			// Discard whatever was captured; errors here are not worth surfacing.
			await stopCapture().catch(() => {});
			this.#outputName = null;
		}
		this.#store.reset();
	}

	updateCameraBubblePosition(): void {
		// No camera bubble in native screen capture.
	}

	/** Pulls one frame out with ffmpeg rather than decoding the whole file in
	 * a hidden `<video>`. */
	async #thumbnail(outputName: string): Promise<string> {
		const ffmpeg = createFFmpegEngine();
		const thumbName = `${outputName}.thumb.jpg`;
		try {
			await ffmpeg.initialize();
			const exit = await ffmpeg.exec([
				'-ss', '1',
				'-i', outputName,
				'-frames:v', '1',
				'-vf', 'scale=640:-2',
				'-q:v', '4',
				thumbName
			]);
			if (exit !== 0) return '';

			const bytes = await ffmpeg.readFile(thumbName);
			const blob = new Blob([bytes], { type: 'image/jpeg' });
			await ffmpeg.deleteFile(thumbName).catch(() => {});
			return URL.createObjectURL(blob);
		} catch {
			// A missing thumbnail is cosmetic; never fail the recording over it.
			return '';
		} finally {
			ffmpeg.terminate();
		}
	}

	async #countdown(): Promise<void> {
		return new Promise((resolve) => {
			let count = 3;
			this.#store.countdownValue = count;
			const interval = setInterval(() => {
				count--;
				this.#store.countdownValue = count;
				if (count <= 0) {
					clearInterval(interval);
					resolve();
				}
			}, 1000);
		});
	}

	#startTimer(): void {
		this.#startedAt = Date.now();
		this.#timer = setInterval(() => {
			if (this.#store.isRecording) {
				this.#store.elapsedSeconds = Math.floor((Date.now() - this.#startedAt) / 1000);
			}
		}, 200);
	}

	#stopTimer(): void {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}
}
