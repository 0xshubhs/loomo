/// <reference lib="webworker" />

import { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpeg: FFmpeg | null = null;

type WorkerMessage =
	| { type: 'init'; payload: { multithreaded: boolean } }
	| { type: 'exec'; payload: { id: string; args: string[] } }
	| { type: 'writeFile'; payload: { path: string; data: ArrayBuffer } }
	| { type: 'readFile'; payload: { id: string; path: string } }
	| { type: 'deleteFile'; payload: { path: string } }
	| { type: 'cancel'; payload: { id: string } };

type WorkerResponse =
	| { type: 'ready' }
	| { type: 'progress'; payload: { id: string; progress: number; time: number } }
	| { type: 'log'; payload: { id: string; level: string; message: string } }
	| { type: 'result'; payload: { id: string; exitCode: number } }
	| { type: 'fileData'; payload: { id: string; data: ArrayBuffer } }
	| { type: 'error'; payload: { id: string; error: string } };

let currentOpId: string | null = null;

/**
 * Fetch a URL and convert it to a blob URL.
 * This avoids COEP issues with cross-origin CDN resources.
 */
async function fetchToBlobURL(url: string, mimeType: string): Promise<string> {
	const response = await fetch(url);
	const blob = await response.blob();
	return URL.createObjectURL(new Blob([blob], { type: mimeType }));
}

async function initialize(multithreaded: boolean): Promise<void> {
	ffmpeg = new FFmpeg();

	ffmpeg.on('progress', ({ progress, time }) => {
		self.postMessage({
			type: 'progress',
			payload: { id: currentOpId ?? 'unknown', progress, time },
		} satisfies WorkerResponse);
	});

	ffmpeg.on('log', ({ type, message }) => {
		self.postMessage({
			type: 'log',
			payload: { id: currentOpId ?? 'unknown', level: type, message },
		} satisfies WorkerResponse);
	});

	// Use single-threaded by default - more compatible and doesn't require SharedArrayBuffer
	// Multi-threaded needs SharedArrayBuffer which needs strict COOP/COEP
	const useMultiThread = multithreaded && typeof SharedArrayBuffer !== 'undefined';

	const baseURL = useMultiThread
		? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
		: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

	try {
		const coreURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
		const wasmURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

		const loadConfig: any = { coreURL, wasmURL };

		if (useMultiThread) {
			loadConfig.workerURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');
		}

		await ffmpeg.load(loadConfig);
	} catch (err) {
		// If multi-threaded fails, fall back to single-threaded
		if (useMultiThread) {
			const stBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
			const coreURL = await fetchToBlobURL(`${stBaseURL}/ffmpeg-core.js`, 'text/javascript');
			const wasmURL = await fetchToBlobURL(`${stBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
			await ffmpeg.load({ coreURL, wasmURL });
		} else {
			throw err;
		}
	}

	self.postMessage({ type: 'ready' } satisfies WorkerResponse);
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
	const msg = e.data;

	try {
		switch (msg.type) {
			case 'init':
				await initialize(msg.payload.multithreaded);
				break;

			case 'exec': {
				if (!ffmpeg) throw new Error('FFmpeg not initialized');
				currentOpId = msg.payload.id;

				const exitCode = await ffmpeg.exec(msg.payload.args);

				currentOpId = null;
				self.postMessage({
					type: 'result',
					payload: { id: msg.payload.id, exitCode },
				} satisfies WorkerResponse);
				break;
			}

			case 'writeFile': {
				if (!ffmpeg) throw new Error('FFmpeg not initialized');
				await ffmpeg.writeFile(msg.payload.path, new Uint8Array(msg.payload.data));
				break;
			}

			case 'readFile': {
				if (!ffmpeg) throw new Error('FFmpeg not initialized');
				const data = await ffmpeg.readFile(msg.payload.path);
				const buffer = data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : new TextEncoder().encode(data as string).buffer;
				self.postMessage(
					{
						type: 'fileData',
						payload: { id: msg.payload.id, data: buffer },
					} satisfies WorkerResponse,
					[buffer] as any
				);
				break;
			}

			case 'deleteFile': {
				if (!ffmpeg) throw new Error('FFmpeg not initialized');
				await ffmpeg.deleteFile(msg.payload.path);
				break;
			}

			case 'cancel': {
				break;
			}
		}
	} catch (error) {
		self.postMessage({
			type: 'error',
			payload: {
				id: (msg as any).payload?.id ?? 'unknown',
				error: String(error),
			},
		} satisfies WorkerResponse);
	}
};
