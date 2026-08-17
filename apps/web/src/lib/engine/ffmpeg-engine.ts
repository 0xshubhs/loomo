import { isDesktop } from '$lib/desktop/env.js';
import { FFmpegBridge } from './ffmpeg-bridge.svelte.js';
import { NativeFFmpegEngine } from './native-ffmpeg.svelte.js';

export type OperationCallback = {
	onProgress?: (progress: number) => void;
	onLog?: (message: string) => void;
};

/**
 * What the editor needs from FFmpeg, independent of where it runs.
 *
 * Two implementations satisfy this: `FFmpegBridge` (ffmpeg.wasm in a Web
 * Worker, used on the web) and `NativeFFmpegEngine` (the real ffmpeg binary
 * shipped with the desktop app). Both keep the virtual-filename semantics
 * inherited from ffmpeg.wasm's MEMFS — `writeFile('input.mp4')`, then
 * `exec(['-i', 'input.mp4', …])` — so callers such as the export pipeline
 * never learn which one they were handed.
 */
export interface FFmpegEngine {
	readonly ready: boolean;
	readonly busy: boolean;
	readonly currentOperation: string | null;
	readonly initProgress: string;

	initialize(): Promise<void>;
	/** Resolves with the process exit code; rejects when ffmpeg itself errors. */
	exec(args: string[], callbacks?: OperationCallback): Promise<number>;
	writeFile(path: string, data: ArrayBuffer | Uint8Array): Promise<void>;
	/**
	 * Streams a File across without materialising it in memory. Only the
	 * native engine implements this; callers must fall back to `writeFile`.
	 */
	writeFileStreaming?(
		path: string,
		file: File,
		onProgress?: (fraction: number) => void
	): Promise<void>;
	readFile(path: string): Promise<ArrayBuffer>;
	deleteFile(path: string): Promise<void>;
	terminate(): void;
}

/**
 * Picks the engine that fits the host. Synchronous, so component setup can
 * keep doing `const ffmpeg = createFFmpegEngine()` at the top level.
 */
export function createFFmpegEngine(): FFmpegEngine {
	return isDesktop() ? new NativeFFmpegEngine() : new FFmpegBridge();
}
