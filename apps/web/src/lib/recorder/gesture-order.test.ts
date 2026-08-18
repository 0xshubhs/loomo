import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecordingSession } from './recording-session.js';
import type { RecorderStore } from '$lib/state/recorder.svelte.js';

/**
 * The order in which a recording starts.
 *
 * Screen capture is only granted inside the gesture that asked for it. The
 * recorder ran a three-second countdown first, by which point the browser had
 * long since decided the click was over, so every attempt on Wayland died with
 * "getDisplayMedia must be called from a user gesture handler".
 *
 * Asking first is also the order users expect: choose the screen, then watch
 * the countdown, then record.
 */

/** Records the sequence of interesting calls. */
function harness(options: { mode?: string } = {}) {
	const calls: string[] = [];

	const track = () => ({ stop: vi.fn(), onended: null as unknown });
	const stream = (kind: 'video' | 'audio') => ({
		getTracks: () => [track()],
		getVideoTracks: () => (kind === 'video' ? [track()] : []),
		getAudioTracks: () => (kind === 'audio' ? [track()] : []),
	});

	const mediaDevices = {
		getDisplayMedia: vi.fn(async () => {
			calls.push('getDisplayMedia');
			return stream('video') as unknown as MediaStream;
		}),
		getUserMedia: vi.fn(async () => {
			calls.push('getUserMedia');
			return stream('audio') as unknown as MediaStream;
		}),
		enumerateDevices: vi.fn(async () => []),
	};

	vi.stubGlobal('navigator', { mediaDevices });

	class FakeMediaRecorder {
		static isTypeSupported() {
			return true;
		}
		state = 'inactive';
		ondataavailable: unknown = null;
		onstop: unknown = null;
		start() {
			calls.push('record');
			this.state = 'recording';
		}
		stop() {}
		pause() {}
		resume() {}
	}
	vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

	// mergeStreams builds one, and jsdom is not loaded for these tests.
	class FakeMediaStream {
		constructor(private tracks: unknown[] = []) {}
		getTracks() {
			return this.tracks;
		}
		getVideoTracks() {
			return this.tracks;
		}
		getAudioTracks() {
			return [];
		}
	}
	vi.stubGlobal('MediaStream', FakeMediaStream);

	const store = {
		mode: options.mode ?? 'screen-only',
		quality: '1080p',
		selectedCameraId: null,
		selectedMicId: null,
		systemAudioEnabled: false,
		countdownValue: 0,
		cameraStream: null,
		isRecording: false,
		isPaused: false,
		startCountdown: () => calls.push('countdown'),
		startRecording: () => calls.push('startRecording'),
		setError: (message: string) => calls.push(`error:${message}`),
	} as unknown as RecorderStore;

	return { calls, store, mediaDevices };
}

describe('starting a screen recording', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	async function runStart(session: RecordingSession) {
		const started = session.start();
		// The countdown is a real three seconds of wall clock.
		await vi.advanceTimersByTimeAsync(4000);
		await started;
	}

	it('asks for the screen before starting the countdown', async () => {
		const { calls, store } = harness();

		await runStart(new RecordingSession(store));

		expect(calls.indexOf('getDisplayMedia')).toBeLessThan(calls.indexOf('countdown'));
	});

	it('asks for the screen before anything else at all', async () => {
		// Any await ahead of it spends the gesture, not just the countdown.
		const { calls, store } = harness();

		await runStart(new RecordingSession(store));

		expect(calls[0]).toBe('getDisplayMedia');
	});

	it('still records once the countdown finishes', async () => {
		const { calls, store } = harness();

		await runStart(new RecordingSession(store));

		expect(calls.indexOf('countdown')).toBeLessThan(calls.indexOf('record'));
		expect(calls).toContain('startRecording');
	});

	it('does not request the screen for an audio-only recording', async () => {
		const { calls, store } = harness({ mode: 'audio' });

		await runStart(new RecordingSession(store));

		expect(calls).not.toContain('getDisplayMedia');
	});

	it('requests the camera before the countdown too', async () => {
		const { calls, store } = harness({ mode: 'camera-only' });

		await runStart(new RecordingSession(store));

		expect(calls.indexOf('getUserMedia')).toBeLessThan(calls.indexOf('countdown'));
	});
});
