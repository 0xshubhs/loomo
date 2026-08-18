import { describe, it, expect } from 'vitest';
import {
	parseLoudnessOutput,
	gainToTarget,
	gainFilter,
	isNegligible,
	loudnessAnalysisArgs,
	DEFAULT_LOUDNESS_TARGET,
} from './loudness.js';

/**
 * Matching clip loudness.
 *
 * From a real project: one clip measured -11.5 dB mean and the next -23.0 dB.
 * The export reproduced both exactly, so the second half sounded like the
 * volume had been turned down halfway through.
 */

/** ffmpeg prints the JSON among ordinary log lines, so tests use the real shape. */
function ffmpegOutput(values: Partial<Record<string, string>> = {}): string {
	const body = {
		input_i: '-23.0',
		input_tp: '-5.2',
		input_lra: '7.1',
		input_thresh: '-33.4',
		output_i: '-16.0',
		target_offset: '0.0',
		...values,
	};
	return [
		'  Stream #0:0: Audio: aac, 44100 Hz, stereo',
		'[Parsed_loudnorm_0 @ 0x5555] ',
		JSON.stringify(body, null, 2),
		'size=N/A time=00:00:03.00 bitrate=N/A speed=  50x',
	].join('\n');
}

describe('reading the measurement', () => {
	it('finds the JSON among the log lines', () => {
		const measurement = parseLoudnessOutput(ffmpegOutput());

		expect(measurement).toEqual({ integrated: -23, truePeak: -5.2 });
	});

	it('returns nothing when the clip has no audio', () => {
		expect(parseLoudnessOutput('Output file does not contain any stream')).toBeNull();
	});

	it('returns nothing for silence, which no gain can rescue', () => {
		expect(parseLoudnessOutput(ffmpegOutput({ input_i: '-inf' }))).toBeNull();
	});

	it('survives truncated or malformed output', () => {
		expect(parseLoudnessOutput('{ "input_i": ')).toBeNull();
	});
});

describe('working out the gain', () => {
	it('lifts a quiet clip to the target', () => {
		// The -23 dB clip from the real project.
		const gain = gainToTarget({ integrated: -23, truePeak: -8 }, DEFAULT_LOUDNESS_TARGET);

		expect(gain).toBeCloseTo(7, 5);
	});

	it('turns a loud clip down', () => {
		const gain = gainToTarget({ integrated: -11.5, truePeak: -6 }, DEFAULT_LOUDNESS_TARGET);

		expect(gain).toBeCloseTo(-4.5, 5);
	});

	it('brings two mismatched clips to within a hair of each other', () => {
		// The whole point: 11.5 dB apart before, level after.
		const quiet = gainToTarget({ integrated: -23, truePeak: -8 });
		const loud = gainToTarget({ integrated: -11.5, truePeak: -6 });

		expect(-23 + quiet).toBeCloseTo(-11.5 + loud, 5);
	});

	it('will not push a clip into clipping to reach the target', () => {
		// Reaching -16 would want +13 dB, but the peak is already at -2 dBTP,
		// leaving only 1 dB of headroom.
		const gain = gainToTarget({ integrated: -29, truePeak: -2 }, DEFAULT_LOUDNESS_TARGET);

		expect(gain).toBeCloseTo(1, 5);
	});

	it('turns down a clip that is already past the ceiling', () => {
		// Leaving it alone would preserve the mismatch this exists to remove.
		const gain = gainToTarget({ integrated: -10, truePeak: 0.5 }, DEFAULT_LOUDNESS_TARGET);

		expect(gain).toBeLessThan(0);
	});

	it('honours a different target', () => {
		const gain = gainToTarget({ integrated: -30, truePeak: -20 }, { targetLufs: -14, ceilingDbtp: -1 });

		expect(gain).toBeCloseTo(16, 5);
	});
});

describe('turning a gain into a filter', () => {
	it('states the correction in dB, so the filtergraph stays readable', () => {
		expect(gainFilter(7)).toBe('volume=7.00dB');
	});

	it('writes a cut as a negative value', () => {
		expect(gainFilter(-4.5)).toBe('volume=-4.50dB');
	});

	it('skips a correction too small to hear', () => {
		// Not worth forcing a re-encode for.
		expect(gainFilter(0.2)).toBeNull();
		expect(isNegligible(0.2)).toBe(true);
	});

	it('keeps a correction that is audible', () => {
		expect(isNegligible(0.9)).toBe(false);
	});
});

describe('the analysis pass', () => {
	it('asks for machine-readable output', () => {
		// Without print_format=json the numbers only appear in prose that
		// changes between ffmpeg versions.
		expect(loudnessAnalysisArgs('clip.mp4')).toContain('loudnorm=print_format=json');
	});

	it('decodes nothing it does not have to', () => {
		expect(loudnessAnalysisArgs('clip.mp4')).toEqual([
			'-i', 'clip.mp4', '-af', 'loudnorm=print_format=json', '-f', 'null', '-',
		]);
	});

	it('measures only the part of the source the timeline uses', () => {
		const args = loudnessAnalysisArgs('clip.mp4', { sourceStart: 12, duration: 4 });

		expect(args.slice(0, 5)).toEqual(['-ss', '12', '-i', 'clip.mp4', '-t']);
	});

	it('omits the seek for a clip that starts at the beginning', () => {
		expect(loudnessAnalysisArgs('clip.mp4', { sourceStart: 0, duration: 4 })).not.toContain('-ss');
	});
});
