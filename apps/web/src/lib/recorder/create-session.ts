import type { RecorderStore } from '$lib/state/recorder.svelte.js';
import type { RecordingResult } from '$lib/types/recorder.js';
import { RecordingSession } from './recording-session.js';
import { NativeRecordingSession } from './native-recording-session.js';
import { isDesktop } from '$lib/desktop/env.js';
import type { CaptureCapabilities } from '$lib/desktop/capture.js';
import { captureCapabilities, knownCaptureCapabilities } from '$lib/desktop/capture.js';

/** The slice of a session the recorder UI actually drives. */
export interface AnyRecordingSession {
	readonly canPause: boolean;
	start(): Promise<void>;
	pause(): void;
	resume(): void;
	stop(): Promise<RecordingResult>;
	cancel(): void | Promise<void>;
	updateCameraBubblePosition(x: number, y: number): void;
}

export interface SessionChoice {
	session: AnyRecordingSession;
	/** True when ffmpeg is grabbing the screen instead of `getDisplayMedia`. */
	native: boolean;
	/** Explains a fallback to the user; null when nothing needs saying. */
	notice: string | null;
}

/**
 * Chooses how to record.
 *
 * Native ffmpeg capture is preferred for plain screen recording on the desktop,
 * because `getDisplayMedia` is unreliable in system webviews. Camera and
 * audio-only modes stay on `getUserMedia`, which webviews handle fine, and
 * screen+camera stays on the browser path because compositing the camera
 * bubble needs a live canvas.
 *
 * When the native backend can't run — a Wayland session, most often — this
 * falls back to the browser recorder and passes along the reason so the UI can
 * warn that screen capture may fail.
 */
export async function createRecordingSession(store: RecorderStore): Promise<SessionChoice> {
	return chooseSession(store, isDesktop() ? await captureCapabilities() : null);
}

/**
 * The same choice without awaiting, for the start click.
 *
 * `getDisplayMedia` is only granted inside the gesture that asked for it, and
 * a single await beforehand is enough to lose it — which is why starting a
 * recording on Wayland failed with "must be called from a user gesture
 * handler". Capabilities are prefetched when the recorder screen mounts, so by
 * the time anyone clicks, the answer is already known.
 */
export function createRecordingSessionSync(store: RecorderStore): SessionChoice | null {
	if (!isDesktop()) return chooseSession(store, null);

	const capabilities = knownCaptureCapabilities();
	return capabilities ? chooseSession(store, capabilities) : null;
}

function chooseSession(store: RecorderStore, capabilities: CaptureCapabilities | null): SessionChoice {
	if (!capabilities) {
		return { session: new RecordingSession(store), native: false, notice: null };
	}

	const wantsScreen = store.mode === 'screen-only' || store.mode === 'screen-cam';

	if (capabilities.available && store.mode === 'screen-only') {
		return { session: new NativeRecordingSession(store), native: true, notice: null };
	}

	return {
		session: new RecordingSession(store),
		native: false,
		// The browser path is not a degraded one on Wayland: WebKitGTK routes
		// getDisplayMedia through xdg-desktop-portal, which is the same
		// ScreenCast API OBS uses there. Worth saying, since the old wording
		// read like a warning that recording would not work.
		notice: wantsScreen && !capabilities.available ? capabilities.reason : null
	};
}
