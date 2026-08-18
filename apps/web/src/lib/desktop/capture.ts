import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './env.js';

export interface CaptureCapabilities {
	available: boolean;
	/** "x11grab" | "avfoundation" | "gdigrab" | "none" */
	backend: string;
	/** Why native capture is off, when it is. Worth showing to the user. */
	reason: string | null;
	supportsAudio: boolean;
	supportsRegion: boolean;
}

export interface CaptureSource {
	id: string;
	label: string;
	kind: 'screen' | 'audio';
}

export interface CaptureRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CaptureOptions {
	fps?: number;
	screen?: string;
	audioDevice?: string | null;
	region?: CaptureRegion | null;
	crf?: number;
	preset?: string;
	outputName?: string;
}

export interface CaptureStarted {
	outputName: string;
	outputPath: string;
	/** The full ffmpeg argv, handy when a capture fails and you need to see why. */
	command: string[];
}

export interface CaptureResult {
	outputName: string;
	outputPath: string;
	duration: number;
	sizeBytes: number;
}

const UNAVAILABLE: CaptureCapabilities = {
	available: false,
	backend: 'none',
	reason: 'Native capture needs the desktop app.',
	supportsAudio: false,
	supportsRegion: false
};

/**
 * Whether ffmpeg can grab the screen directly on this machine.
 *
 * The answer is no on the web, and no in a Wayland session, where the caller
 * should fall back to the browser's `getDisplayMedia` recorder. `reason`
 * explains which case it is.
 */
let cachedCapabilities: CaptureCapabilities | null = null;

export async function captureCapabilities(): Promise<CaptureCapabilities> {
	if (cachedCapabilities) return cachedCapabilities;
	if (!isDesktop()) return (cachedCapabilities = UNAVAILABLE);
	try {
		return (cachedCapabilities = await invoke<CaptureCapabilities>('capture_capabilities'));
	} catch (error) {
		return (cachedCapabilities = { ...UNAVAILABLE, reason: String(error) });
	}
}

/**
 * The answer if it has already been fetched, without awaiting.
 *
 * Starting a recording must not await anything before `getDisplayMedia`: the
 * browser only honours it inside the click that triggered it, and a single
 * intervening await is enough for WebKit to refuse with "must be called from a
 * user gesture handler". The recorder screen warms this on mount so the click
 * path can stay synchronous.
 */
export function knownCaptureCapabilities(): CaptureCapabilities | null {
	return cachedCapabilities;
}

/** Fetches capabilities ahead of time, so the start click does not have to. */
export function prefetchCaptureCapabilities(): void {
	void captureCapabilities();
}

/** Screens and audio inputs the native backend can record. */
export async function captureSources(): Promise<CaptureSource[]> {
	if (!isDesktop()) return [];
	try {
		return await invoke<CaptureSource[]>('capture_sources');
	} catch {
		return [];
	}
}

export async function startCapture(options: CaptureOptions = {}): Promise<CaptureStarted> {
	return await invoke<CaptureStarted>('capture_start', {
		options: {
			fps: options.fps ?? 30,
			screen: options.screen ?? null,
			audioDevice: options.audioDevice ?? null,
			region: options.region ?? null,
			crf: options.crf ?? 20,
			preset: options.preset ?? 'veryfast',
			outputName: options.outputName ?? null
		}
	});
}

/**
 * Ends the recording and waits for ffmpeg to finalise the container. This is
 * not instant — an MP4's index is written on close, and killing ffmpeg instead
 * would leave an unplayable file.
 */
export async function stopCapture(): Promise<CaptureResult> {
	return await invoke<CaptureResult>('capture_stop');
}

/** Seconds elapsed in the running capture, or null when idle. */
export async function captureStatus(): Promise<number | null> {
	if (!isDesktop()) return null;
	return await invoke<number | null>('capture_status');
}

/**
 * Reads a finished capture out of the scratch directory as a Blob, so it can
 * flow into the same post-recording UI the browser recorder feeds.
 */
export async function readCapture(outputName: string): Promise<Blob> {
	const bytes = await invoke<ArrayBuffer>('scratch_read', { path: outputName });
	return new Blob([bytes], { type: 'video/mp4' });
}
