import { describe, it, expect } from 'vitest';
import {
	windowIndexFor,
	windowStart,
	offsetInWindow,
	windowToPrefetch,
	windowKey,
	windowsToKeep,
	WINDOW_SECONDS,
	PREFETCH_LEAD_SECONDS,
} from './audio-windows.js';

/**
 * Preview audio used to decode a whole clip. A 50-minute source produced a
 * 536 MB WAV and a 1.07 GB float buffer, and the app was OOM-killed with the
 * status line still reading "Extracting audio". These are the rules that keep
 * it to a couple of windows regardless of length.
 */

describe('placing a moment in a window', () => {
	it('puts the start of the source in the first window', () => {
		expect(windowIndexFor(0, 30)).toBe(0);
	});

	it('keeps a whole window in one index', () => {
		expect(windowIndexFor(29.9, 30)).toBe(0);
	});

	it('rolls over exactly on the boundary', () => {
		expect(windowIndexFor(30, 30)).toBe(1);
	});

	it('handles a point an hour in', () => {
		expect(windowIndexFor(3600, 30)).toBe(120);
	});

	it('treats a negative time as the start', () => {
		expect(windowIndexFor(-5, 30)).toBe(0);
	});

	it('reports where a window begins', () => {
		expect(windowStart(3, 30)).toBe(90);
	});

	it('reports the offset within a window', () => {
		expect(offsetInWindow(95, 3, 30)).toBe(5);
	});

	it('gives a zero offset at the very start of a window', () => {
		expect(offsetInWindow(90, 3, 30)).toBe(0);
	});
});

describe('fetching the next window in time', () => {
	// Extraction takes a moment. Asking exactly at the boundary leaves a gap
	// of silence every thirty seconds.
	it('does nothing early in a window', () => {
		expect(windowToPrefetch(5, 600, 30, 5)).toBeNull();
	});

	it('asks for the next one once inside the lead', () => {
		expect(windowToPrefetch(26, 600, 30, 5)).toBe(1);
	});

	it('leads by enough to hide an accurate seek', () => {
		// Seeking accurately decodes and discards everything before the
		// window: ~0.5ms per second of source, so about 6s three hours in.
		expect(PREFETCH_LEAD_SECONDS).toBeGreaterThanOrEqual(10);
	});

	it('asks for the one after the current window, not the next by time', () => {
		expect(windowToPrefetch(86, 600, 30, 5)).toBe(3);
	});

	it('stops at the end of the source', () => {
		// 600s is exactly twenty windows; there is no twenty-first.
		expect(windowToPrefetch(595, 600, 30, 5)).toBeNull();
	});

	it('does not prefetch past the end of a short clip', () => {
		expect(windowToPrefetch(2, 10, 30, 5)).toBeNull();
	});
});

describe('what to hold on to', () => {
	it('keeps the current window and the next', () => {
		expect(windowsToKeep(45, 30)).toEqual([1, 2]);
	});

	it('drops everything behind the playhead', () => {
		// A window already played is not played again without a seek, and a
		// seek re-extracts in a few hundred milliseconds. Holding more is
		// exactly how this ran out of memory.
		expect(windowsToKeep(600, 30)).not.toContain(19);
	});

	it('names windows per asset, so two clips do not collide', () => {
		expect(windowKey('a1', 3)).not.toBe(windowKey('a2', 3));
	});
});

describe('the default window', () => {
	it('is small enough that length stops mattering', () => {
		// 44.1kHz stereo float is ~350 KB/s. Two windows has to stay in single
		// -digit megabytes or this fixes nothing.
		const bytesPerWindow = WINDOW_SECONDS * 44100 * 2 * 4;

		expect(bytesPerWindow * 2).toBeLessThan(32 * 1024 * 1024);
	});
});
