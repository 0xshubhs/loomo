import { describe, it, expect } from 'vitest';
import { PlaybackStore } from './playback.svelte.js';

/**
 * `Ctrl+Shift+M` was in the keyboard map and wired to nothing, and
 * `playback.volume` was state no code read. Both reach the preview now, so
 * these are the rules they follow.
 */

describe('master level', () => {
	it('is full by default', () => {
		expect(new PlaybackStore().outputVolume).toBe(1);
	});

	it('is silent when muted', () => {
		const playback = new PlaybackStore();

		playback.toggleMute();

		expect(playback.outputVolume).toBe(0);
	});

	it('returns to the level that was set, not to full', () => {
		// Which is why mute is separate state rather than volume = 0.
		const playback = new PlaybackStore();
		playback.setVolume(0.3);

		playback.toggleMute();
		playback.toggleMute();

		expect(playback.outputVolume).toBe(0.3);
	});

	it('clamps a level outside 0-1', () => {
		const playback = new PlaybackStore();

		playback.setVolume(4);
		expect(playback.outputVolume).toBe(1);

		playback.setVolume(-1);
		expect(playback.outputVolume).toBe(0);
	});

	it('treats moving the slider off zero as a request to hear something', () => {
		const playback = new PlaybackStore();
		playback.toggleMute();

		playback.setVolume(0.5);

		expect(playback.muted).toBe(false);
		expect(playback.outputVolume).toBe(0.5);
	});

	it('leaves mute alone when the slider is dragged to zero', () => {
		const playback = new PlaybackStore();

		playback.setVolume(0);

		expect(playback.outputVolume).toBe(0);
	});
});

describe('the transport', () => {
	it('does not seek before the start', () => {
		const playback = new PlaybackStore();

		playback.seek(-5);

		expect(playback.currentTime).toBe(0);
	});

	it('does not run past the start when stepping back', () => {
		const playback = new PlaybackStore();
		playback.seek(1);

		playback.seekRelative(-5);

		expect(playback.currentTime).toBe(0);
	});
});
