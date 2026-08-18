/**
 * Matching how loud each clip sounds.
 *
 * Two clips cut together commonly differ by 10dB or more — measured on a real
 * project here, one source sat at -11.5 dB mean and the next at -23.0 dB. The
 * export reproduced both faithfully, which is correct and also unusable: the
 * second half sounds like someone turned the volume down.
 *
 * The approach is deliberately conservative. Loudness is measured per clip with
 * EBU R128 (`loudnorm`'s analysis pass), and the correction applied is a plain
 * gain — not `loudnorm`'s own filter, which also compresses. A fixed gain moves
 * a clip to the target without touching its dynamics, so a quiet recording gets
 * louder rather than flatter.
 */

/** What one analysis pass reports about a clip. */
export interface LoudnessMeasurement {
	/** Integrated loudness, LUFS. */
	integrated: number;
	/** True peak, dBTP. */
	truePeak: number;
}

export interface LoudnessTarget {
	/** Where clips should land. -16 LUFS is the usual streaming/web figure. */
	targetLufs: number;
	/** Never push a clip past this true peak, to stay clear of clipping. */
	ceilingDbtp: number;
}

export const DEFAULT_LOUDNESS_TARGET: LoudnessTarget = {
	targetLufs: -16,
	ceilingDbtp: -1,
};

/** Arguments for the analysis pass over one clip. */
export function loudnessAnalysisArgs(
	path: string,
	options: { sourceStart?: number; duration?: number } = {}
): string[] {
	const args: string[] = [];
	if ((options.sourceStart ?? 0) > 0.01) args.push('-ss', String(options.sourceStart));
	args.push('-i', path);
	if (options.duration && options.duration > 0) args.push('-t', String(options.duration));
	// print_format=json makes the result machine-readable; without it the
	// numbers only appear in prose that changes between ffmpeg versions.
	args.push('-af', 'loudnorm=print_format=json', '-f', 'null', '-');
	return args;
}

/**
 * Pulls the measurement out of ffmpeg's stderr.
 *
 * The JSON object is printed among ordinary log lines, so it is located by
 * brace matching rather than by parsing the whole stream. Returns null when the
 * clip has no audio at all — a common, unremarkable case.
 */
export function parseLoudnessOutput(output: string): LoudnessMeasurement | null {
	const start = output.lastIndexOf('{');
	const end = output.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) return null;

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(output.slice(start, end + 1));
	} catch {
		return null;
	}

	const integrated = Number(parsed.input_i);
	const truePeak = Number(parsed.input_tp);
	// Silence measures as -inf, which is not something a gain can rescue.
	if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) return null;

	return { integrated, truePeak };
}

/**
 * How much to lift or cut a clip, in dB.
 *
 * The gain is whatever moves the clip to the target, then reduced if that would
 * push its true peak above the ceiling. Reduced, never raised: a clip already
 * hotter than the ceiling is turned down, since leaving it alone would keep the
 * mismatch the whole feature exists to remove.
 */
export function gainToTarget(
	measurement: LoudnessMeasurement,
	target: LoudnessTarget = DEFAULT_LOUDNESS_TARGET
): number {
	const wanted = target.targetLufs - measurement.integrated;
	const headroom = target.ceilingDbtp - measurement.truePeak;
	return Math.min(wanted, headroom);
}

/** Below this the correction is inaudible and not worth an extra encode. */
const NEGLIGIBLE_DB = 0.5;

export function isNegligible(gainDb: number): boolean {
	return Math.abs(gainDb) < NEGLIGIBLE_DB;
}

/**
 * The filter for a gain, or null when none is needed.
 *
 * ffmpeg's `volume` takes a dB value directly, which keeps the intent legible
 * in the filtergraph instead of hiding it in a linear multiplier.
 */
export function gainFilter(gainDb: number): string | null {
	if (isNegligible(gainDb)) return null;
	return `volume=${gainDb.toFixed(2)}dB`;
}
