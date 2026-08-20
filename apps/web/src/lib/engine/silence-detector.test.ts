import { describe, it, expect } from 'vitest';
import {
	silenceDetectArgs,
	thresholdToDb,
	parseSilenceOutput,
	detectSilences,
	DEFAULT_SILENCE_OPTIONS,
} from './silence-detector.js';

/**
 * Silence detection used to decode the whole file to an AudioBuffer — ~40MB
 * per minute, so a 50-minute source was over a gigabyte before the scan even
 * started, and the feature was simply unavailable on a real recording.
 * `silencedetect` streams and returns text.
 */

describe('converting the threshold', () => {
	it('turns the usual default into a sensible level', () => {
		// 0.01 linear is -40dB, which is the figure people actually use.
		expect(thresholdToDb(0.01)).toBe(-40);
	});

	it('maps full scale to zero', () => {
		expect(thresholdToDb(1)).toBe(0);
	});

	it('floors perfect silence rather than passing -Infinity to a filter', () => {
		expect(thresholdToDb(0)).toBe(-100);
		expect(Number.isFinite(thresholdToDb(0))).toBe(true);
	});

	it('floors a threshold too small to express', () => {
		expect(thresholdToDb(1e-12)).toBe(-100);
	});

	it('does not go positive on a threshold above full scale', () => {
		expect(thresholdToDb(5)).toBe(0);
	});
});

describe('the analysis pass', () => {
	it('asks the filter for the requested threshold and duration', () => {
		const args = silenceDetectArgs('clip.mp4', { threshold: 0.01, minDuration: 0.5 });

		expect(args.join(' ')).toContain('silencedetect=noise=-40dB:d=0.5');
	});

	it('writes no output file', () => {
		// The answer is in what ffmpeg logs; producing a file would mean
		// re-encoding the whole source for nothing.
		const args = silenceDetectArgs('clip.mp4', DEFAULT_SILENCE_OPTIONS);

		expect(args.slice(-3)).toEqual(['-f', 'null', '-']);
	});

	it('reads the source once', () => {
		const args = silenceDetectArgs('clip.mp4', DEFAULT_SILENCE_OPTIONS);

		expect(args.filter((a) => a === '-i')).toHaveLength(1);
	});
});

describe('reading the regions back', () => {
	const lines = [
		'[silencedetect @ 0x55d] silence_start: 12.345',
		'[silencedetect @ 0x55d] silence_end: 15.678 | silence_duration: 3.333',
		'[silencedetect @ 0x55d] silence_start: 40',
		'[silencedetect @ 0x55d] silence_end: 42.5 | silence_duration: 2.5',
	];

	it('pairs starts with ends', () => {
		expect(parseSilenceOutput(lines)).toEqual([
			{ startTime: 12.345, endTime: 15.678, duration: 15.678 - 12.345 },
			{ startTime: 40, endTime: 42.5, duration: 2.5 },
		]);
	});

	it('ignores the rest of the ffmpeg chatter', () => {
		const noisy = ['ffmpeg version 7.1', 'Stream #0:0 Video: h264', ...lines];

		expect(parseSilenceOutput(noisy)).toHaveLength(2);
	});

	it('closes a file that ended while still silent', () => {
		// The filter prints a start and never a matching end.
		const trailing = ['[silencedetect @ 0x1] silence_start: 100'];

		expect(parseSilenceOutput(trailing, 120)).toEqual([
			{ startTime: 100, endTime: 120, duration: 20 },
		]);
	});

	it('drops a trailing start when the duration is not known', () => {
		// Better than inventing an end time.
		expect(parseSilenceOutput(['[silencedetect @ 0x1] silence_start: 100'])).toEqual([]);
	});

	it('treats a negative start as the beginning of the file', () => {
		const early = [
			'[silencedetect @ 0x1] silence_start: -0.008',
			'[silencedetect @ 0x1] silence_end: 2 | silence_duration: 2.008',
		];

		expect(parseSilenceOutput(early)[0].startTime).toBe(0);
	});

	it('parses what the bundled binary actually printed', () => {
		// Captured from loomo-ffmpeg on a 2s tone / 3s silence / 2s tone file,
		// rather than assumed from the documentation.
		const real = [
			'[silencedetect @ 0x759d70003380] silence_start: 1.999977',
			'[silencedetect @ 0x759d70003380] silence_end: 5.000045 | silence_duration: 3.000068',
		];

		const regions = parseSilenceOutput(real, 7);

		expect(regions).toHaveLength(1);
		expect(regions[0].startTime).toBeCloseTo(2, 2);
		expect(regions[0].endTime).toBeCloseTo(5, 2);
	});

	it('finds nothing in a file with no silence', () => {
		expect(parseSilenceOutput(['ffmpeg version 7.1', 'frame= 100'])).toEqual([]);
	});

	it('skips an end that arrives before its start', () => {
		const broken = [
			'[silencedetect @ 0x1] silence_start: 10',
			'[silencedetect @ 0x1] silence_end: 10 | silence_duration: 0',
		];

		expect(parseSilenceOutput(broken)).toEqual([]);
	});

	it('ignores an end with no start before it', () => {
		expect(parseSilenceOutput(['[silencedetect @ 0x1] silence_end: 5'])).toEqual([]);
	});
});

describe('the in-page scan still works, for the web build', () => {
	function buffer(samples: number[], sampleRate = 100): AudioBuffer {
		const data = Float32Array.from(samples);
		return {
			sampleRate,
			length: data.length,
			duration: data.length / sampleRate,
			numberOfChannels: 1,
			getChannelData: () => data,
		} as unknown as AudioBuffer;
	}

	it('finds a silent stretch', () => {
		// One second loud, two seconds silent, at 100Hz.
		const samples = [...Array(100).fill(0.5), ...Array(200).fill(0)];

		const regions = detectSilences(buffer(samples), { threshold: 0.01, minDuration: 0.5 });

		expect(regions).toHaveLength(1);
		expect(regions[0].startTime).toBeCloseTo(1, 1);
	});

	it('ignores a gap shorter than the minimum', () => {
		const samples = [...Array(100).fill(0.5), ...Array(10).fill(0), ...Array(100).fill(0.5)];

		expect(detectSilences(buffer(samples), { threshold: 0.01, minDuration: 0.5 })).toEqual([]);
	});
});
