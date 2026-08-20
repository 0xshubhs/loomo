import { describe, it, expect } from 'vitest';
import {
	transcriptionWindows,
	shiftSegments,
	stitchWindow,
	TRANSCRIBE_OVERLAP_SECONDS,
	TRANSCRIBE_WINDOW_SECONDS,
} from './transcription-windows.js';
import type { CaptionSegment } from '$lib/types/index.js';

/**
 * Captions used to hand the whole file to the recogniser, so they stopped
 * working entirely once `asset-bytes` refused anything over 400 MB — the user's
 * recordings are 50-minute, ~900 MB files. These are the rules that let a
 * transcript be assembled from windows without the captions landing at the
 * wrong time or losing the words at a boundary.
 */

let counter = 0;

function segment(text: string, startTime: number, endTime: number): CaptionSegment {
	return { id: `s${counter++}`, text, startTime, endTime };
}

function texts(segments: CaptionSegment[]): string[] {
	return segments.map((s) => s.text);
}

function allWords(segments: CaptionSegment[]): string[] {
	return segments.flatMap((s) => s.text.split(/\s+/)).filter(Boolean);
}

describe('splitting a recording into windows', () => {
	it('covers a fifty-minute recording rather than refusing it', () => {
		const windows = transcriptionWindows(3000, 300, 3);

		expect(windows.length).toBeGreaterThan(1);
		expect(windows[0].start).toBe(0);
		expect(windows[windows.length - 1].start + windows[windows.length - 1].duration).toBeCloseTo(
			3000,
			5
		);
	});

	it('leaves no second of the source uncovered', () => {
		const windows = transcriptionWindows(1000, 300, 3);

		for (let i = 1; i < windows.length; i++) {
			const previousEnd = windows[i - 1].start + windows[i - 1].duration;
			expect(windows[i].start).toBeLessThan(previousEnd);
		}
	});

	it('makes each window repeat the end of the one before it', () => {
		const windows = transcriptionWindows(1000, 300, 3);
		const previousEnd = windows[0].start + windows[0].duration;

		// The repeat is what stops a word straddling the boundary from being
		// heard as two halves and discarded by both windows.
		expect(previousEnd - windows[1].start).toBeCloseTo(3, 5);
	});

	it('uses one window for a clip shorter than a window', () => {
		expect(transcriptionWindows(45, 300, 3)).toEqual([{ index: 0, start: 0, duration: 45 }]);
	});

	it('does not read past the end of the source', () => {
		const windows = transcriptionWindows(310, 300, 3);
		const last = windows[windows.length - 1];

		expect(last.start + last.duration).toBeLessThanOrEqual(310);
	});

	it('skips a trailing window that would only repeat what was already heard', () => {
		// A source ending exactly on a window boundary has nothing left for a
		// second window but the three seconds it would repeat, and a recogniser
		// session costs real time to produce nothing.
		expect(transcriptionWindows(300, 300, 3)).toHaveLength(1);
		expect(transcriptionWindows(302, 300, 3)).toHaveLength(2);
	});

	it('has nothing to transcribe when the duration is unknown', () => {
		expect(transcriptionWindows(0)).toEqual([]);
		expect(transcriptionWindows(-10)).toEqual([]);
		expect(transcriptionWindows(Number.NaN)).toEqual([]);
	});

	it('still finishes when asked for an overlap as long as the window', () => {
		// An overlap that ate the whole stride would loop forever on a long file.
		const windows = transcriptionWindows(1000, 100, 100);

		expect(windows.length).toBeLessThan(30);
		expect(windows[windows.length - 1].start).toBeLessThan(1000);
	});

	it('keeps a window small enough that the file size stops mattering', () => {
		// 16 kHz mono s16le is 32 KB/s, and this blob crosses the IPC whole.
		const bytesPerWindow = TRANSCRIBE_WINDOW_SECONDS * 16000 * 2;

		expect(bytesPerWindow).toBeLessThan(16 * 1024 * 1024);
	});

	it('overlaps by longer than a spoken word', () => {
		expect(TRANSCRIBE_OVERLAP_SECONDS).toBeGreaterThanOrEqual(2);
	});
});

describe('placing a window on the timeline', () => {
	it('moves captions from window time to source time', () => {
		const shifted = shiftSegments([segment('hello there', 4, 6)], 600);

		expect(shifted[0].startTime).toBe(604);
		expect(shifted[0].endTime).toBe(606);
	});

	it('leaves the first window where the recogniser put it', () => {
		expect(shiftSegments([segment('hello', 1, 2)], 0)[0].startTime).toBe(1);
	});

	it('does not rewrite the caller’s segments', () => {
		const original = segment('hello', 1, 2);

		shiftSegments([original], 600);

		expect(original.startTime).toBe(1);
	});

	it('lands the last window of a fifty-minute file near the end, not the start', () => {
		const windows = transcriptionWindows(3000, 300, 3);
		const last = windows[windows.length - 1];

		const placed = shiftSegments([segment('goodbye', 10, 12)], last.start);

		expect(placed[0].startTime).toBeGreaterThan(2600);
	});
});

describe('joining two windows at the seam', () => {
	it('keeps the transcript in order across a join', () => {
		const first = [segment('the quick brown fox', 0, 2)];

		const joined = stitchWindow(first, [segment('jumps over', 1, 3)], 297, 3);

		expect(texts(joined)).toEqual(['the quick brown fox', 'jumps over']);
		expect(joined[1].startTime).toBe(298);
	});

	it('does not say the overlapped words twice', () => {
		// Both windows hear 297-300s, so both transcribe "and then we".
		const first = [segment('so we opened it and then we', 290, 299)];
		const second = [segment('and then we looked inside', 0.5, 4)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(allWords(joined)).toEqual(
			'so we opened it and then we looked inside'.split(' ')
		);
	});

	it('removes a repeat even when the two windows group words differently', () => {
		// The recogniser emits roughly eight words at a time and does not group
		// the same way twice, so whole segments rarely repeat but words do.
		const first = [segment('a quick brown fox jumps over the lazy', 291, 299)];
		const second = [segment('over the lazy dog and then', 0.5, 4)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(allWords(joined)).toEqual(
			'a quick brown fox jumps over the lazy dog and then'.split(' ')
		);
	});

	it('ignores punctuation and case when spotting a repeat', () => {
		const first = [segment('we tried it, Then stopped', 293, 299)];
		const second = [segment('then stopped for lunch', 0.5, 3)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(allWords(joined)).toEqual('we tried it, Then stopped for lunch'.split(' '));
	});

	it('keeps the word a boundary would otherwise have cut in half', () => {
		// The first window ends mid-word and hears nothing usable; the second
		// starts three seconds earlier and hears the whole thing. Nothing
		// repeats, so nothing is dropped.
		const first = [segment('and the measurement was', 294, 300)];
		const second = [segment('extraordinary given the setup', 0.2, 3)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(allWords(joined)).toContain('extraordinary');
		expect(allWords(joined)).toHaveLength(8);
	});

	it('does not delete a real word that merely repeats one common word', () => {
		// "the" turning up on both sides of a seam is a coincidence, not the
		// same speech heard twice; dropping it would eat a word nobody said
		// twice.
		const first = [segment('we walked past the', 295, 299)];
		const second = [segment('the meeting had started', 0.5, 3)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(allWords(joined)).toEqual('we walked past the the meeting had started'.split(' '));
	});

	it('leaves matching words alone when they are nowhere near the seam', () => {
		// The same phrase said again a minute into the window is a second
		// utterance, not the overlap.
		const first = [segment('right so anyway', 290, 299)];
		const second = [segment('right so anyway', 60, 63)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(joined).toHaveLength(2);
	});

	it('moves a trimmed segment forward to when its remaining words are said', () => {
		const first = [segment('we tried the second one', 293, 299)];
		const second = [segment('the second one worked', 0, 4)];

		const joined = stitchWindow(first, second, 297, 3);

		// Three of four words removed, so the caption should appear near the end
		// of the span rather than at its start, where nothing is being said yet.
		expect(joined[1].text).toBe('worked');
		expect(joined[1].startTime).toBeCloseTo(297 + 3, 5);
	});

	it('drops a window whose every word was already heard', () => {
		const first = [segment('all of this was already said', 293, 300)];
		const second = [segment('already said', 0.5, 2)];

		const joined = stitchWindow(first, second, 297, 3);

		expect(texts(joined)).toEqual(['all of this was already said']);
	});

	it('starts the transcript from the first window without hunting for a seam', () => {
		const joined = stitchWindow([], [segment('hello there', 1, 3)], 0, 3);

		expect(texts(joined)).toEqual(['hello there']);
	});

	it('survives a silent window that produced nothing', () => {
		const first = [segment('some words', 10, 12)];

		expect(stitchWindow(first, [], 297, 3)).toHaveLength(1);
	});
});
