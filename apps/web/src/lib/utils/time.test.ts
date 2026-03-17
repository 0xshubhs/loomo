import { describe, it, expect } from 'vitest';
import {
	formatTimecode,
	formatDuration,
	secondsToPixels,
	pixelsToSeconds,
	snapToFrame,
	clampTime,
	formatRecordingTime,
	relativeTime,
} from './time';

describe('formatTimecode', () => {
	it('formats zero', () => {
		expect(formatTimecode(0)).toBe('00:00:00:00');
	});

	it('formats seconds with frames', () => {
		expect(formatTimecode(65.5, 30)).toBe('00:01:05:15');
	});

	it('formats hours', () => {
		expect(formatTimecode(3661)).toBe('01:01:01:00');
	});
});

describe('formatDuration', () => {
	it('formats zero', () => {
		expect(formatDuration(0)).toBe('00:00');
	});

	it('formats minutes and seconds', () => {
		expect(formatDuration(90)).toBe('01:30');
	});

	it('floors fractional seconds', () => {
		expect(formatDuration(59.9)).toBe('00:59');
	});
});

describe('secondsToPixels / pixelsToSeconds', () => {
	it('converts seconds to pixels', () => {
		expect(secondsToPixels(5, 100)).toBe(500);
	});

	it('converts pixels to seconds', () => {
		expect(pixelsToSeconds(500, 100)).toBe(5);
	});

	it('round-trips correctly', () => {
		const pps = 120;
		const seconds = 3.5;
		expect(pixelsToSeconds(secondsToPixels(seconds, pps), pps)).toBe(seconds);
	});
});

describe('snapToFrame', () => {
	it('snaps to nearest frame at 30fps', () => {
		const snapped = snapToFrame(1.016, 30);
		expect(snapped).toBeCloseTo(1.0, 2);
	});

	it('snaps to nearest frame at 24fps', () => {
		const snapped = snapToFrame(0.5, 24);
		expect(snapped).toBeCloseTo(0.5, 2);
	});
});

describe('clampTime', () => {
	it('clamps below minimum', () => {
		expect(clampTime(-1, 0, 10)).toBe(0);
	});

	it('clamps above maximum', () => {
		expect(clampTime(15, 0, 10)).toBe(10);
	});

	it('passes through values in range', () => {
		expect(clampTime(5, 0, 10)).toBe(5);
	});
});

describe('formatRecordingTime', () => {
	it('formats under a minute', () => {
		expect(formatRecordingTime(45)).toBe('00:45');
	});

	it('formats minutes', () => {
		expect(formatRecordingTime(125)).toBe('02:05');
	});

	it('includes hours when over 60 minutes', () => {
		expect(formatRecordingTime(3661)).toBe('01:01:01');
	});

	it('zero seconds', () => {
		expect(formatRecordingTime(0)).toBe('00:00');
	});
});

describe('relativeTime', () => {
	it('shows "Just now" for recent timestamps', () => {
		expect(relativeTime(Date.now() - 5000)).toBe('Just now');
	});

	it('shows minutes ago', () => {
		expect(relativeTime(Date.now() - 5 * 60 * 1000)).toBe('5m ago');
	});

	it('shows hours ago', () => {
		expect(relativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago');
	});

	it('shows "Yesterday"', () => {
		expect(relativeTime(Date.now() - 24 * 60 * 60 * 1000)).toBe('Yesterday');
	});

	it('shows days ago', () => {
		expect(relativeTime(Date.now() - 5 * 24 * 60 * 60 * 1000)).toBe('5d ago');
	});

	it('accepts ISO string timestamps', () => {
		const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		expect(relativeTime(fiveMinAgo)).toBe('5m ago');
	});
});
