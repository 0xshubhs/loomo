import { Channel, invoke } from '@tauri-apps/api/core';
import { writeInChunks, streamFileInChunks, type ChunkSink } from './chunked-write.js';
import type { FFmpegEngine, OperationCallback } from './ffmpeg-engine.js';

type ExecEvent =
	| { kind: 'progress'; progress: number; outTime: number }
	| { kind: 'log'; line: string };

interface FFmpegInfo {
	version: string;
	scratchDir: string;
}


export interface NativeMediaProbe {
	duration: number;
	width: number;
	height: number;
	fps: number;
	codec: string;
	audioCodec: string;
	bitrate: number;
}

/**
 * Drives the ffmpeg binary bundled with the desktop app.
 *
 * Behaviourally interchangeable with `FFmpegBridge`: the same virtual
 * filenames, the same 0..1 progress, the same exit codes. The differences are
 * all upside — no wasm heap ceiling on file size, every codec the real
 * ffmpeg has, and hardware-speed encoding.
 */
export class NativeFFmpegEngine implements FFmpegEngine {
	ready = $state<boolean>(false);
	busy = $state<boolean>(false);
	currentOperation = $state<string | null>(null);
	initProgress = $state<string>('');

	/** ffmpeg's own version banner, shown in the editor status bar. */
	version = $state<string>('');

	#opCounter = 0;
	#inFlight = new Set<string>();

	async initialize(): Promise<void> {
		this.initProgress = 'Starting FFmpeg...';
		try {
			const info = await invoke<FFmpegInfo>('ffmpeg_init');
			this.version = info.version;
			this.ready = true;
			this.initProgress = 'Ready';
		} catch (error) {
			this.initProgress = 'Failed';
			throw new Error(`Native FFmpeg unavailable: ${error}`);
		}
	}

	async exec(args: string[], callbacks: OperationCallback = {}): Promise<number> {
		const id = `op-${++this.#opCounter}`;
		this.busy = true;
		this.currentOperation = args.join(' ').slice(0, 100);
		this.#inFlight.add(id);

		const channel = new Channel<ExecEvent>();
		channel.onmessage = (event) => {
			if (event.kind === 'progress') callbacks.onProgress?.(event.progress);
			else callbacks.onLog?.(event.line);
		};

		try {
			// durationHint is passed explicitly rather than omitted; the Rust
			// side falls back to the `Duration:` line ffmpeg prints for its
			// inputs, which covers every call the editor makes.
			return await invoke<number>('ffmpeg_exec', {
				id,
				args,
				durationHint: null,
				onEvent: channel
			});
		} finally {
			this.#inFlight.delete(id);
			this.busy = this.#inFlight.size > 0;
			if (!this.busy) this.currentOperation = null;
		}
	}

	async writeFile(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		await writeInChunks(bytes, this.#sink(path));
	}

	/** Streams a `File` to scratch without ever holding it whole in memory. */
	async writeFileStreaming(
		path: string,
		file: File,
		onProgress?: (fraction: number) => void
	): Promise<void> {
		await streamFileInChunks(file, this.#sink(path), onProgress);
	}

	#sink(path: string): ChunkSink {
		return async (chunk, append) => {
			await invoke('scratch_write', chunk, {
				headers: {
					'x-loomo-path': path,
					'x-loomo-append': append ? '1' : '0',
				},
			});
		};
	}

	async readFile(path: string): Promise<ArrayBuffer> {
		return await invoke<ArrayBuffer>('scratch_read', { path });
	}

	async deleteFile(path: string): Promise<void> {
		await invoke('scratch_delete', { path });
	}

	terminate(): void {
		for (const id of this.#inFlight) {
			void invoke('ffmpeg_cancel', { id }).catch(() => {});
		}
		this.#inFlight.clear();
		this.busy = false;
		this.currentOperation = null;
		this.ready = false;
	}

	/** Cancels a single operation. Its `exec` resolves with exit code 130. */
	async cancel(id: string): Promise<void> {
		await invoke('ffmpeg_cancel', { id });
	}

	/** Absolute on-disk path of a scratch file. */
	async pathOf(path: string): Promise<string> {
		return await invoke<string>('scratch_path', { path });
	}

	/** Reads real stream metadata via ffprobe, instead of guessing from a
	 * hidden `<video>` element. */
	async probe(path: string): Promise<NativeMediaProbe> {
		return await invoke<NativeMediaProbe>('ffprobe_media', { path });
	}

	/** Copies a scratch file to a destination the user chose. */
	async exportTo(path: string, destination: string): Promise<void> {
		await invoke('scratch_export', { path, destination });
	}
}
