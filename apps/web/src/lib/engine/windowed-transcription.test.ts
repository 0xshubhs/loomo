import { describe, it, expect, vi } from 'vitest';
import { transcribeInWindows, CANCELLED_MESSAGE } from './windowed-transcription.js';
import type { WindowTranscriber } from './windowed-transcription.js';
import type { FFmpegEngine } from './ffmpeg-engine.js';
import type { CaptionSegment } from '$lib/types/index.js';

/**
 * Auto-captions were unavailable on every recording worth captioning: reading a
 * 978 MB scratch file into the page costs three gigabytes once the IPC copies
 * are counted, so `asset-bytes` refuses anything over 400 MB. This is the loop
 * that transcribes such a file a window at a time instead.
 */

function fakeEngine(over: Partial<FFmpegEngine> = {}) {
	const execArgs: string[][] = [];
	const deleted: string[] = [];

	const engine = {
		exec: vi.fn(async (args: string[]) => {
			execArgs.push(args);
			return 0;
		}),
		readFile: vi.fn(async () => new Uint8Array(1024).buffer as ArrayBuffer),
		deleteFile: vi.fn(async (name: string) => {
			deleted.push(name);
		}),
		...over,
	} as unknown as FFmpegEngine;

	return { engine, execArgs, deleted };
}

function segment(text: string, startTime: number, endTime: number): CaptionSegment {
	return { id: `${text}-${startTime}`, text, startTime, endTime };
}

/** A recogniser that reports the same thing at the top of every window. */
function hears(...perWindow: CaptionSegment[][]): WindowTranscriber {
	let call = 0;
	return async () => perWindow[Math.min(call++, perWindow.length - 1)] ?? [];
}

describe('captioning a file too large to load', () => {
	it('never reads the source whole, only windows of it', async () => {
		const { engine, execArgs } = fakeEngine();

		await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([]),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(execArgs.length).toBeGreaterThan(1);
		for (const args of execArgs) {
			expect(args).toContain('-t');
			expect(Number(args[args.indexOf('-t') + 1])).toBeLessThanOrEqual(300);
		}
	});

	it('seeks accurately, because the fast seek lands in the wrong place', async () => {
		// `-ss` before `-i` seeks to the nearest packet boundary, which would
		// offset every caption in the window by an unknown amount.
		const { engine, execArgs } = fakeEngine();

		await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([]),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(execArgs[0].indexOf('-ss')).toBeGreaterThan(execArgs[0].indexOf('-i'));
	});

	it('times captions against the whole recording, not against their window', async () => {
		const { engine } = fakeEngine();

		const segments = await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([segment('first thing said', 2, 4)], [segment('later on', 10, 12)]),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(segments[0].startTime).toBe(2);
		// Window two starts at 297s, so its captions belong five minutes in.
		expect(segments[1].startTime).toBe(307);
	});

	it('does not repeat the speech the windows deliberately overlap', async () => {
		const { engine } = fakeEngine();

		const segments = await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 600,
			transcribe: hears(
				[segment('and so we went ahead with it', 292, 299)],
				[segment('ahead with it anyway', 0.5, 3)],
				[]
			),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		const words = segments.flatMap((s) => s.text.split(' '));
		expect(words).toEqual('and so we went ahead with it anyway'.split(' '));
	});

	it('tidies up each window file instead of leaving ten of them behind', async () => {
		const { engine, deleted } = fakeEngine();

		await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([]),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(deleted).toHaveLength(4);
		expect(new Set(deleted).size).toBe(4);
	});
});

describe('telling the user what is happening', () => {
	it('reports which part it is on, so an hour of work is not silent', async () => {
		const { engine } = fakeEngine();
		const statuses: string[] = [];

		await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([segment('hello', 1, 2)]),
			onProgress: (s) => statuses.push(s),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(statuses.some((s) => s.includes('part 1 of 4'))).toBe(true);
		expect(statuses.some((s) => s.includes('part 4 of 4'))).toBe(true);
	});

	it('passes the recogniser’s own progress through', async () => {
		const { engine } = fakeEngine();
		const statuses: string[] = [];
		const transcribe: WindowTranscriber = async (_audio, _lang, onProgress) => {
			onProgress?.('Listening...');
			return [];
		};

		await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 300,
			transcribe,
			onProgress: (s) => statuses.push(s),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(statuses.some((s) => s.includes('Listening...'))).toBe(true);
	});
});

describe('when something goes wrong part way through', () => {
	it('stops at the next window once cancelled', async () => {
		const { engine } = fakeEngine();
		const controller = new AbortController();
		const transcribe: WindowTranscriber = async () => {
			controller.abort();
			return [segment('one window of speech', 1, 3)];
		};

		await expect(
			transcribeInWindows({
				engine,
				scratchName: 'media_a1.mkv',
				assetId: 'a1',
				durationSeconds: 3000,
				transcribe,
				abortSignal: controller.signal,
				windowSeconds: 300,
				overlapSeconds: 3,
			})
		).rejects.toThrow(CANCELLED_MESSAGE);
	});

	it('does not start extracting at all if cancelled before it begins', async () => {
		const { engine, execArgs } = fakeEngine();
		const controller = new AbortController();
		controller.abort();

		await expect(
			transcribeInWindows({
				engine,
				scratchName: 'media_a1.mkv',
				assetId: 'a1',
				durationSeconds: 900,
				transcribe: hears([]),
				abortSignal: controller.signal,
			})
		).rejects.toThrow(CANCELLED_MESSAGE);
		expect(execArgs).toHaveLength(0);
	});

	it('keeps the transcript when one window will not decode', async () => {
		// Losing forty minutes of finished work to one unreadable window would
		// be worse than a gap in the captions.
		let call = 0;
		const { engine } = fakeEngine({
			exec: vi.fn(async () => (call++ === 1 ? 1 : 0)),
		});

		const segments = await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([segment('still here', 1, 2)]),
			windowSeconds: 300,
			overlapSeconds: 3,
		});

		expect(segments.length).toBe(3);
	});

	it('skips a window that extracted no audio at all', async () => {
		const { engine } = fakeEngine({
			readFile: vi.fn(async () => new ArrayBuffer(0)),
		});

		const segments = await transcribeInWindows({
			engine,
			scratchName: 'media_a1.mkv',
			assetId: 'a1',
			durationSeconds: 900,
			transcribe: hears([segment('never asked for', 1, 2)]),
		});

		expect(segments).toEqual([]);
	});

	it('says so rather than guessing when the duration is unknown', async () => {
		const { engine } = fakeEngine();

		await expect(
			transcribeInWindows({
				engine,
				scratchName: 'media_a1.mkv',
				assetId: 'a1',
				durationSeconds: 0,
				transcribe: hears([]),
			})
		).rejects.toThrow(/duration/i);
	});
});
