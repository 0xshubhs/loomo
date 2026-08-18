import { isDesktop } from '$lib/desktop/env.js';
import { FFmpegBridge } from './ffmpeg-bridge.svelte.js';
import { NativeFFmpegEngine } from './native-ffmpeg.svelte.js';

/** What a probe reports about a stored file. */
export interface MediaProbe {
	duration: number;
	width: number;
	height: number;
	fps: number;
	codec: string;
	audioCodec: string;
	bitrate: number;
}

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

	/**
	 * Largest input this engine can accept, or `null` when it has no such
	 * limit. Only ffmpeg.wasm does — it decodes inside a bounded wasm heap.
	 * The native binary reads straight off disk, so applying the wasm ceiling
	 * to it rejects perfectly ordinary files: a 474MB source failed to export
	 * on the desktop for exactly this reason.
	 */
	readonly maxInputBytes: number | null;

	/**
	 * Whether files written here survive on real storage the OS can reach.
	 *
	 * When true, a finished render never has to enter JavaScript: it is already
	 * a file, and saving it is a copy. Reading a half-gigabyte output back into
	 * an ArrayBuffer only to write it out again is how the webview ran out of
	 * memory on large exports.
	 */
	readonly persistentStore: boolean;

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
	/**
	 * Whether a virtual filename currently holds bytes. Lets callers reuse a
	 * file staged earlier instead of writing it again; engines without a
	 * persistent store simply omit this.
	 */
	fileExists?(path: string): Promise<boolean>;
	/** Byte length of a stored file, for reporting an output's size. */
	fileSize?(path: string): Promise<number>;
	/**
	 * Reads a stored file's stream layout. Used to decide whether a rendered
	 * file has audio to mix against — mapping a stream that is not there fails
	 * the whole command.
	 */
	probe?(path: string): Promise<MediaProbe>;
	terminate(): void;
}

/**
 * Picks the engine that fits the host. Synchronous, so component setup can
 * keep doing `const ffmpeg = createFFmpegEngine()` at the top level.
 */
export function createFFmpegEngine(): FFmpegEngine {
	const desktop = isDesktop();
	const engine: FFmpegEngine = desktop ? new NativeFFmpegEngine() : new FFmpegBridge();
	// Which engine is in play decides whether the native preview can arm at
	// all, so it is worth stating outright rather than inferring later.
	console.info(
		`[engine] ${desktop ? 'native ffmpeg' : 'ffmpeg.wasm'}; streaming=${!!engine.writeFileStreaming}`
	);
	return engine;
}
