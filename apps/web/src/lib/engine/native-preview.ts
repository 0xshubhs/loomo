import { Channel, invoke } from '@tauri-apps/api/core';
import { isDesktop } from '$lib/desktop/env.js';

/**
 * Preview frames decoded by the bundled ffmpeg instead of the webview.
 *
 * On Linux the webview's own video path failed three different ways on the
 * same machine — composited black on NVIDIA hybrid GPUs, software-slow with
 * the DMABuf workaround, and intermittently wedged at readyState 0 on
 * ordinary MP4s. Decoding ourselves is what native editors do, and it turns
 * "can this machine play this file" into a question about ffmpeg alone, which
 * demonstrably decodes these files at better than realtime.
 *
 * Frames arrive as JPEG bytes over an IPC channel and become ImageBitmaps.
 * Frame N of a stream has source timestamp `startTime + N/fps`; the caller
 * paints the newest frame at or before the playback clock and discards the
 * rest, so decode hiccups degrade smoothness rather than sync.
 */

/** Roughly four seconds at 30fps — slack for decode jitter, not a throttle. */
const MAX_QUEUED_FRAMES = 120;

/**
 * Frames cross the IPC as base64.
 *
 * A Tauri channel is a JSON transport; raw byte payloads sent over one never
 * reached the page, which showed up as a preview frozen on its last frame with
 * no error on either side.
 */
function base64ToBlob(encoded: string): Blob {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new Blob([bytes], { type: 'image/jpeg' });
}

export interface NativeFrame {
	/** Source-file timestamp in seconds. */
	time: number;
	bitmap: ImageBitmap;
}

export class NativePreviewStream {
	#id = `pv-${Math.random().toString(36).slice(2, 10)}`;
	#generation = 0;
	#queue: NativeFrame[] = [];
	#running = false;

	get running(): boolean {
		return this.#running;
	}

	/** Begins decoding at `startTime`; replaces any stream already running. */
	async start(scratchName: string, startTime: number, fps: number, width: number): Promise<void> {
		const generation = ++this.#generation;
		this.clear();
		this.#running = true;

		let index = 0;
		const channel = new Channel<string>();
		channel.onmessage = async (encoded) => {
			// Stamp before the async decode so ordering can't drift.
			const time = startTime + index++ / fps;
			try {
				const bitmap = await createImageBitmap(base64ToBlob(encoded));
				if (generation !== this.#generation) {
					bitmap.close();
					return;
				}
				this.#queue.push({ time, bitmap });
				// Bounded, but generously: the decoder is paced to realtime, so
				// this is slack for jitter rather than a throttle. Too small a
				// cap silently drops the frames the playhead is about to need.
				while (this.#queue.length > MAX_QUEUED_FRAMES) {
					this.#queue.shift()?.bitmap.close();
				}
			} catch {
				/* one bad frame is not worth stopping the stream */
			}
		};

		await invoke('preview_start', {
			id: this.#id,
			name: scratchName,
			startTime,
			fps,
			width: Math.round(width),
			onFrame: channel,
		});
	}

	/**
	 * Newest frame at or before `time`, discarding everything older.
	 * Returns null when no new frame is due — keep showing the last one.
	 */
	takeFrameFor(time: number): NativeFrame | null {
		let chosen: NativeFrame | null = null;
		while (this.#queue.length > 0 && this.#queue[0].time <= time) {
			chosen?.bitmap.close();
			chosen = this.#queue.shift()!;
		}
		return chosen;
	}

	/** Seconds of decoded frames waiting ahead of the clock. */
	buffered(): number {
		return this.#queue.length;
	}

	async stop(): Promise<void> {
		this.#generation++;
		this.#running = false;
		this.clear();
		await invoke('preview_stop', { id: this.#id }).catch(() => {});
	}

	private clear(): void {
		for (const frame of this.#queue) frame.bitmap.close();
		this.#queue = [];
	}
}

/** One frame at a timestamp, for scrubbing. ~100ms on a 720p source. */
export async function nativeFrameAt(
	scratchName: string,
	time: number,
	width: number
): Promise<ImageBitmap | null> {
	if (!isDesktop()) return null;
	try {
		const bytes = await invoke<ArrayBuffer>('preview_frame', {
			name: scratchName,
			time,
			width: Math.round(width),
		});
		return await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
	} catch {
		return null;
	}
}
