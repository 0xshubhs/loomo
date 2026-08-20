import type { Clip, MosaicRegion, SpeedCurve, SpeedPoint } from '$lib/types/timeline.js';
import type { VideoEffect } from '$lib/types/effects.js';

/**
 * FFmpeg translations of effects the preview renders with CSS.
 *
 * The preview and the export are two different renderers, so anything added to
 * `utils/video-effects.ts` has to be mirrored here or it silently disappears
 * when the user exports. That is exactly the bug this module was written to
 * fix: `videoEffect` was rendered in the preview and never referenced by the
 * export pipeline at all.
 *
 * Where CSS and FFmpeg disagree the comment says so. Time-varying effects use
 * FFmpeg expressions on `t`, which is why several filters carry `eval=frame`.
 */

function n(value: number): string {
	return Number(value.toFixed(4)).toString();
}

/** Wraps a value containing commas so the filtergraph parser leaves it alone. */
function q(expr: string): string {
	return `'${expr}'`;
}

/**
 * CSS `brightness()` multiplies; FFmpeg's `eq=brightness` adds an offset.
 * `lutyuv` on the luma plane is multiplicative like CSS, and being a lookup
 * table it costs far less than a per-pixel expression.
 */
function multiplyBrightness(factor: number): string | null {
	if (Math.abs(factor - 1) < 0.001) return null;
	return `lutyuv=y=${q(`val*${n(factor)}`)}`;
}

/** Sepia as a partial blend toward the classic matrix, matching CSS `sepia()`. */
function sepia(amount: number): string | null {
	if (amount <= 0.001) return null;
	const a = Math.min(amount, 1);
	const mix = (target: number, identity: number) => n(identity + (target - identity) * a);
	return [
		`colorchannelmixer=`,
		`rr=${mix(0.393, 1)}:rg=${mix(0.769, 0)}:rb=${mix(0.189, 0)}:`,
		`gr=${mix(0.349, 0)}:gg=${mix(0.686, 1)}:gb=${mix(0.168, 0)}:`,
		`br=${mix(0.272, 0)}:bg=${mix(0.534, 0)}:bb=${mix(0.131, 1)}`,
	].join('');
}

/**
 * Video-filter chain for a Motion FX preset.
 *
 * `intensity` is 0-100 and matches the preview's `t` scaling, so the two
 * renderers land in the same place for the colour-grading effects. Effects the
 * preview drives with `Math.random()` use FFmpeg's own `random()` instead, so
 * they are equivalent in character rather than frame-identical.
 */
export function buildVideoEffectFilters(effect: VideoEffect | undefined): string[] {
	if (!effect || effect.type === 'none') return [];

	const t = Math.min(Math.max(effect.intensity, 0), 100) / 100;
	const parts: string[] = [];
	const push = (filter: string | null) => {
		if (filter) parts.push(filter);
	};

	switch (effect.type) {
		case 'blur':
			// CSS blur(Npx) is a Gaussian of standard deviation N.
			push(`gblur=sigma=${n(t * 10)}`);
			break;

		case 'vhs':
			// The preview also jitters horizontally; that is left out here
			// because shifting inside a chain needs a split/overlay subgraph
			// and the grade is what actually reads as VHS.
			push(`eq=saturation=${n(1.2 + t * 0.5)}:contrast=${n(1.1 + t * 0.2)}`);
			push(multiplyBrightness(1 + t * 0.1));
			break;

		case 'glitch':
			push(`hue=h=${q(`random(1)*${n(t * 90)}`)}`);
			break;

		case 'filmic':
			push(sepia(t * 0.4));
			push(`eq=contrast=${n(1.1 + t * 0.2)}:saturation=${n(0.8 + t * 0.1)}`);
			push(multiplyBrightness(0.95 - t * 0.05));
			break;

		case 'glow':
			push(`gblur=sigma=${n(t * 1.5)}`);
			push(`eq=contrast=0.95`);
			push(multiplyBrightness(1 + t * 0.3));
			break;

		case 'vaporwave':
			push(`hue=h=${n(180 + t * 60)}`);
			push(`eq=saturation=${n(1.5 + t * 0.5)}:contrast=1.1`);
			break;

		case 'flash':
			// Oscillating brightness, evaluated per frame.
			push(`eq=brightness=${q(`abs(sin(t*${n(2 + t * 6)}))*${n(t * 2)}`)}:eval=frame`);
			break;

		case 'pulse':
			push(
				`scale=w=${q(`trunc(iw*(1+sin(t*${n(3 + t * 4)})*${n(t * 0.05)})/2)*2`)}:` +
					`h=${q(`trunc(ih*(1+sin(t*${n(3 + t * 4)})*${n(t * 0.05)})/2)*2`)}:eval=frame`
			);
			break;

		case 'kaleidoscope':
			push(`rotate=${q(`sin(t)*${n((t * 5 * Math.PI) / 180)}`)}:c=none`);
			push(`hue=h=${q(`t*${n(30 * t)}`)}`);
			push(`eq=saturation=1.3`);
			break;

		case 'bokeh':
			push(`gblur=sigma=${n(t * 3)}`);
			push(`eq=saturation=1.2`);
			push(multiplyBrightness(1.1 + t * 0.15));
			break;

		case 'mirror':
			push('hflip');
			break;

		case 'cinematic':
			push(`eq=contrast=${n(1.15 + t * 0.15)}:saturation=${n(0.8 + t * 0.1)}`);
			push(multiplyBrightness(0.95));
			break;
	}

	return parts;
}

export function hasVideoEffect(clip: Clip): boolean {
	return !!clip.videoEffect && clip.videoEffect.type !== 'none';
}

// ── Mosaic ──────────────────────────────────────────────────────────

export function hasMosaics(clip: Clip): boolean {
	return !!clip.mosaics && clip.mosaics.length > 0;
}

/**
 * Filtergraph fragment that pixelates or blurs regions of a frame.
 *
 * A region can only be treated differently from the rest of the frame by
 * splitting the stream, processing the cropped part, and compositing it back,
 * so this returns graph segments rather than a simple filter chain. Regions are
 * applied in order, each one feeding the next.
 *
 * Percentages are resolved against the target resolution here rather than left
 * as expressions, because `crop` needs integers and the export size is known.
 */
export function buildMosaicSubgraph(
	inputLabel: string,
	regions: MosaicRegion[],
	width: number,
	height: number,
	outputLabel: string
): string[] {
	if (regions.length === 0) return [`[${inputLabel}]null[${outputLabel}]`];

	const parts: string[] = [];
	let current = inputLabel;

	regions.forEach((region, index) => {
		const last = index === regions.length - 1;
		const next = last ? outputLabel : `${outputLabel}m${index}`;

		// Clamp to the frame and keep every dimension even and non-zero.
		const cw = Math.max(2, Math.round((Math.min(region.width, 100) / 100) * width / 2) * 2);
		const ch = Math.max(2, Math.round((Math.min(region.height, 100) / 100) * height / 2) * 2);
		const cx = Math.max(0, Math.min(width - cw, Math.round((region.x / 100) * width)));
		const cy = Math.max(0, Math.min(height - ch, Math.round((region.y / 100) * height)));

		const strength = Math.min(Math.max(region.strength, 1), 100);
		// No trailing separator: callers join these segments with ';' themselves.
		const base = `split=2[${next}b${index}][${next}s${index}]`;

		let treatment: string;
		if (region.mode === 'blur') {
			treatment = `gblur=sigma=${n((strength / 100) * 40)}`;
		} else {
			// Downscale then nearest-neighbour back up: the classic mosaic.
			const blocks = Math.max(1, Math.round(Math.min(cw, ch) / Math.max(1, strength / 2)));
			const smallW = Math.max(1, Math.round(cw / Math.max(1, cw / blocks)));
			const smallH = Math.max(1, Math.round(ch / Math.max(1, cw / blocks)));
			treatment = `scale=${smallW}:${smallH}:flags=neighbor,scale=${cw}:${ch}:flags=neighbor`;
		}

		// A region can be limited to part of the clip; without times it is always on.
		const enable =
			region.startTime !== null || region.endTime !== null
				? `:enable=${q(`between(t,${n(region.startTime ?? 0)},${n(region.endTime ?? 1e6)})`)}`
				: '';

		parts.push(`[${current}]${base}`);
		parts.push(`[${next}s${index}]crop=${cw}:${ch}:${cx}:${cy},${treatment}[${next}p${index}]`);
		parts.push(`[${next}b${index}][${next}p${index}]overlay=${cx}:${cy}${enable}[${next}]`);

		current = next;
	});

	return parts;
}

// ── Audio denoise ───────────────────────────────────────────────────

/**
 * FFT denoiser for clip audio.
 *
 * Replaces the old boolean `noiseSuppression`, which set a flag the exporter
 * turned into a fixed `highpass`/`lowpass` pair. `afftdn` actually models the
 * noise floor, and the strength maps onto its 0-97 dB reduction range.
 */
export function buildDenoiseFilter(strength: number): string | null {
	if (strength <= 0) return null;
	const reduction = Math.min(Math.max(strength, 1), 100) * 0.97;
	return `afftdn=nr=${n(reduction)}:nf=-25`;
}

// ── Speed curves ────────────────────────────────────────────────────

export function hasSpeedCurve(clip: Clip): boolean {
	return !!clip.speedCurve?.enabled && (clip.speedCurve.points?.length ?? 0) >= 2;
}

/**
 * Output time as a function of input time, integrated across the curve.
 *
 * Playing a clip at a varying rate means output time is the integral of
 * 1/speed. With speed interpolated linearly between points, each segment
 * integrates in closed form — constant segments are just linear, and ramps
 * give a logarithm. Doing it analytically keeps the result exact rather than
 * accumulating error from sampling.
 */
export function buildSpeedCurveSetpts(curve: SpeedCurve): string | null {
	const points = [...(curve.points ?? [])].sort((a, b) => a.time - b.time);
	if (points.length < 2) return null;

	// Cumulative output time at the start of each segment.
	const offsets: number[] = [0];
	for (let i = 0; i < points.length - 1; i++) {
		offsets.push(offsets[i] + segmentDuration(points[i], points[i + 1]));
	}

	// Past the final point the last speed continues indefinitely.
	const lastPoint = points[points.length - 1];
	const lastSpeed = Math.max(lastPoint.speed, 0.01);
	let expr = `(${n(offsets[offsets.length - 1])}+(T-${n(lastPoint.time)})/${n(lastSpeed)})`;

	for (let i = points.length - 2; i >= 0; i--) {
		expr = `if(lt(T,${n(points[i + 1].time)}),${segmentExpr(points[i], points[i + 1], offsets[i])},${expr})`;
	}

	// Before the first point, the first speed applies.
	const first = points[0];
	if (first.time > 0) {
		expr = `if(lt(T,${n(first.time)}),T/${n(Math.max(first.speed, 0.01))},${expr})`;
	}

	return `setpts=${q(`(${expr})/TB`)}`;
}

function segmentDuration(a: { time: number; speed: number }, b: { time: number; speed: number }): number {
	const span = b.time - a.time;
	if (span <= 0) return 0;
	const sa = Math.max(a.speed, 0.01);
	const sb = Math.max(b.speed, 0.01);
	// Constant rate integrates linearly; a ramp integrates to a logarithm.
	if (Math.abs(sa - sb) < 0.001) return span / sa;
	return (span / (sb - sa)) * Math.log(sb / sa);
}

function segmentExpr(
	a: { time: number; speed: number },
	b: { time: number; speed: number },
	offset: number
): string {
	const span = b.time - a.time;
	const sa = Math.max(a.speed, 0.01);
	const sb = Math.max(b.speed, 0.01);
	if (span <= 0) return n(offset);

	if (Math.abs(sa - sb) < 0.001) {
		return `(${n(offset)}+(T-${n(a.time)})/${n(sa)})`;
	}

	const slope = (sb - sa) / span;
	// offset + (1/slope) * ln(speed(T) / speed(a))
	return `(${n(offset)}+(1/${n(slope)})*log((${n(sa)}+${n(slope)}*(T-${n(a.time)}))/${n(sa)}))`;
}

/**
 * Mean playback rate across a speed curve.
 *
 * Audio cannot follow a varying rate with `atempo`, which only takes a
 * constant. The video timing is exact and the audio is stretched by this
 * average — good enough for short ramps, visibly adrift on long ones. Proper
 * variable-rate audio would need per-segment resampling.
 */
export function averageSpeed(curve: SpeedCurve): number {
	const points = [...(curve.points ?? [])].sort((a, b) => a.time - b.time);
	if (points.length < 2) return 1;

	const totalInput = points[points.length - 1].time - points[0].time;
	if (totalInput <= 0) return 1;

	let totalOutput = 0;
	for (let i = 0; i < points.length - 1; i++) {
		totalOutput += segmentDuration(points[i], points[i + 1]);
	}
	return totalOutput > 0 ? totalInput / totalOutput : 1;
}

// ── Speed curves: audio ─────────────────────────────────────────────

/**
 * One slice of a speed curve, retimed at a single constant rate.
 *
 * Audio cannot follow a continuously varying rate the way `setpts` lets video:
 * `atempo` takes a number, not an expression. So the curve is cut into slices
 * fine enough that a constant rate per slice is indistinguishable from the
 * ramp, and each slice is retimed on its own.
 */
export interface SpeedSegment {
	/** Source time this slice starts at. */
	start: number;
	/** Source time it ends at. */
	end: number;
	/** Constant playback rate for the slice. */
	rate: number;
	/** How long the slice lasts once retimed. */
	outputDuration: number;
}

/** Largest number of slices. Beyond this the filtergraph itself is a problem. */
const MAX_SPEED_SEGMENTS = 256;

/**
 * Shortest slice worth cutting.
 *
 * `atempo` needs a reasonable window to work on, and a slice shorter than this
 * buys accuracy the ear cannot hear while costing another branch of graph.
 */
const MIN_SEGMENT_SECONDS = 0.05;

/**
 * How far the audio may sit from the picture before the slice is split again.
 *
 * Six milliseconds is well inside what anyone can detect on a cut, and two
 * orders of magnitude better than the mean-rate stretch this replaces, which
 * put a 30-second ramp the better part of a second out.
 */
const SEGMENT_TOLERANCE_SECONDS = 0.002;

/**
 * Where a source time lands in the output, following the curve exactly.
 *
 * This is the same closed form `buildSpeedCurveSetpts` emits for the video —
 * deliberately, so the two cannot disagree. A constant rate integrates
 * linearly; a ramp integrates to a logarithm.
 */
function curveOutputAt(points: SpeedPoint[], t: number): number {
	const first = points[0];
	if (t <= first.time) return t / r(Math.max(first.speed, 0.01));

	let offset = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (t < b.time) return segmentIntegral(a, b, t, offset);
		offset += segmentDuration(a, b);
	}

	// Past the final point the last speed continues, as the expression does.
	const last = points[points.length - 1];
	return r(offset) + (t - r(last.time)) / r(Math.max(last.speed, 0.01));
}

/**
 * Rounds a constant the way the emitted expression does.
 *
 * `buildSpeedCurveSetpts` writes its constants through `n()`, which keeps four
 * decimal places, so the video follows a very slightly quantised version of the
 * curve. The audio has to follow the same quantised version rather than the
 * ideal one — matching the picture is the whole point, and an exact integral
 * would leave the two 44 microseconds apart on a 30-second ramp and growing.
 */
function r(value: number): number {
	return Number(value.toFixed(4));
}

/** The integral from `a.time` to `t`, within one leg of the curve. */
function segmentIntegral(
	a: { time: number; speed: number },
	b: { time: number; speed: number },
	t: number,
	offset: number
): number {
	const span = b.time - a.time;
	if (span <= 0) return r(offset);

	const sa = Math.max(a.speed, 0.01);
	const sb = Math.max(b.speed, 0.01);
	if (Math.abs(sa - sb) < 0.001) return r(offset) + (t - r(a.time)) / r(sa);

	const slope = (sb - sa) / span;
	return (
		r(offset) + (1 / r(slope)) * Math.log((r(sa) + r(slope) * (t - r(a.time))) / r(sa))
	);
}

/**
 * Cuts a speed curve into slices audio can actually be retimed by.
 *
 * Every slice's `outputDuration` is the difference of the exact integral at its
 * two ends, so the lengths telescope: the total is the integral over the whole
 * clip, whatever the slicing. That is what keeps the audio ending exactly where
 * the picture does no matter how coarsely the curve had to be cut.
 *
 * Slicing starts at the curve's own points, since those are where the rate
 * changes direction, and then refines whichever slice is furthest from the
 * curve until everything is inside tolerance or the limits are reached.
 */
export function buildSpeedCurveSegments(curve: SpeedCurve, duration: number): SpeedSegment[] {
	const points = [...(curve.points ?? [])].sort((a, b) => a.time - b.time);
	// One point is a constant rate, which the clip's own speed already covers.
	if (points.length < 2 || duration <= 0) return [];

	// Hard stops: the curve's own points, where the rate changes direction.
	const stops = [...new Set([duration, ...points.map((p) => p.time)])]
		.filter((t) => t > 0 && t <= duration)
		.sort((a, b) => a - b);

	// Laid out left to right, taking the longest step that stays in tolerance,
	// rather than by bisecting. Bisection cannot reach the sizes a steep slow
	// section needs: halving a 3-second leg lands on 0.094s, and halving that
	// again falls under the shortest slice worth cutting, so the first tenth of
	// a second of a 0.25x ramp was stuck at 14.7ms out. Stepping forwards
	// spends short slices where the curve is steep and long ones where it is
	// not.
	const cuts: number[] = [0];
	let at = 0;
	let stopIndex = 0;

	while (at < duration - 1e-9 && cuts.length <= MAX_SPEED_SEGMENTS) {
		while (stopIndex < stops.length && stops[stopIndex] <= at + 1e-9) stopIndex++;
		const limit = stopIndex < stops.length ? stops[stopIndex] : duration;

		let step = limit - at;
		while (step > MIN_SEGMENT_SECONDS && sliceError(points, at, at + step) > SEGMENT_TOLERANCE_SECONDS) {
			step = Math.max(MIN_SEGMENT_SECONDS, step / 2);
		}

		// A remainder too short to stand alone is absorbed rather than left as
		// a slice below the minimum.
		if (limit - (at + step) < MIN_SEGMENT_SECONDS) step = limit - at;

		at = Math.min(at + step, duration);
		cuts.push(at);
	}

	// The step loop is bounded by the segment cap, so a punishing curve stops
	// getting finer rather than producing a graph FFmpeg will not accept.
	if (cuts[cuts.length - 1] < duration) cuts[cuts.length - 1] = duration;

	const segments: SpeedSegment[] = [];
	for (let i = 0; i < cuts.length - 1; i++) {
		const start = cuts[i];
		const end = cuts[i + 1];
		const outputDuration = curveOutputAt(points, end) - curveOutputAt(points, start);
		// A slice with no output length would divide by zero and contributes
		// nothing to play anyway.
		if (outputDuration <= 0) continue;
		segments.push({ start, end, rate: (end - start) / outputDuration, outputDuration });
	}

	return segments;
}

/**
 * How far a constant-rate slice strays from the curve at its worst point.
 *
 * Sampled at several interior points rather than only the midpoint. The
 * midpoint is the extreme for a symmetric curve, but a leg that changes
 * steepness across the slice puts the worst error off-centre, and estimating
 * from the middle alone let a 30-second ramp through at 14.7ms — over twice
 * what it was supposed to allow.
 */
function sliceError(points: SpeedPoint[], start: number, end: number): number {
	const outStart = curveOutputAt(points, start);
	const span = curveOutputAt(points, end) - outStart;
	if (span <= 0) return 0;

	const rate = (end - start) / span;
	let worst = 0;
	for (const fraction of [0.25, 0.5, 0.75]) {
		const at = start + (end - start) * fraction;
		worst = Math.max(worst, Math.abs(outStart + (at - start) / rate - curveOutputAt(points, at)));
	}
	return worst;
}

/**
 * `atempo` filters that multiply out to a rate.
 *
 * One instance only accepts 0.5–2.0, so anything outside that has to be
 * chained. Six decimal places because a long chain multiplies its rounding:
 * four was enough for a single filter and is not enough for seven.
 */
export function buildAtempoChain(rate: number): string[] {
	if (!Number.isFinite(rate) || rate <= 0) return [];
	if (Math.abs(rate - 1) < 0.0001) return [];

	const parts: string[] = [];
	let remaining = rate;

	while (remaining > 2) {
		parts.push('atempo=2.000000');
		remaining /= 2;
	}
	while (remaining < 0.5) {
		parts.push('atempo=0.500000');
		remaining /= 0.5;
	}
	if (Math.abs(remaining - 1) > 0.0000005) parts.push(`atempo=${remaining.toFixed(6)}`);

	return parts;
}

/**
 * Extra output time fed into a pitch-preserving stretch to cover its tail loss.
 *
 * `atempo` drops a fixed 20–27ms per instance and `rubberband` 55–70ms, both
 * at the end and both regardless of input length — a window flush. Feeding the
 * slice past its own span and trimming the result back means the surplus is
 * real neighbouring audio rather than silence, and the output lands on its
 * exact length. Measured: 0.200000s and 1.000000s against those targets, from
 * 0.179524s and 0.972585s uncorrected.
 */
const STRETCH_OVERHANG_SECONDS = 0.15;

/**
 * Retimes one slice, exactly, by resampling.
 *
 * `asetrate` reinterprets the sample rate and `aresample` puts it back, which
 * is sample-exact: measured at 0.200000s, 1.000000s and 4.000000s against
 * targets of 0.2, 1 and 4. It shifts pitch, which is what physically happens
 * when footage is sped up or slowed down, so it is the right default for a
 * speed ramp.
 *
 * `atempo` is the pitch-preserving alternative and it cannot hit an exact
 * length: measured against this build it loses a fixed 20–27ms per instance
 * regardless of input length, which is a window flush rather than anything
 * proportional. Over a sliced curve that accumulates — a 6-second swoop came
 * out 192ms short — so pitch preservation costs sync.
 */
function resampleChain(rate: number, sampleRate = 44100): string[] {
	if (Math.abs(rate - 1) < 0.0001) return [];
	return [
		`asetrate=${Math.round(sampleRate * rate)}`,
		`aresample=${sampleRate}`,
		// The rate change rewrites timestamps; concat needs them from zero.
		'asetpts=PTS-STARTPTS',
	];
}

/**
 * The audio half of a speed curve, as filtergraph parts.
 *
 * The source is split once per slice, each branch is trimmed to its own span
 * and retimed at its own rate, and the branches are concatenated back. Slice
 * boundaries are emitted from one shared list of formatted strings, so a
 * slice's end is character-identical to the next slice's start — a rounded gap
 * between them would drop or repeat samples at every seam.
 */
export function buildSpeedCurveAudioGraph(
	inputLabel: string,
	curve: SpeedCurve,
	duration: number,
	outputLabel: string
): string[] {
	const segments = buildSpeedCurveSegments(curve, duration);
	// Nothing to follow: pass the audio straight through rather than making the
	// caller special-case the absence of a curve.
	if (segments.length === 0) return [`[${inputLabel}]anull[${outputLabel}]`];

	// Pitch preservation and exact sync cannot both be had here; the curve says
	// which one it wants.
	const retime = curve.preservePitch
		? (rate: number) => buildAtempoChain(rate)
		: (rate: number) => resampleChain(rate);

	if (segments.length === 1) {
		const chain = retime(segments[0].rate);
		if (chain.length === 0) return [`[${inputLabel}]anull[${outputLabel}]`];
		return [`[${inputLabel}]${chain.join(',')}[${outputLabel}]`];
	}

	const edges = [
		...segments.map((segment) => segment.start.toFixed(6)),
		segments[segments.length - 1].end.toFixed(6),
	];

	const parts: string[] = [];
	const branches = segments.map((_, i) => `${outputLabel}s${i}`);
	parts.push(`[${inputLabel}]asplit=${segments.length}${branches.map((b) => `[${b}]`).join('')}`);

	const retimed: string[] = [];
	segments.forEach((segment, i) => {
		const label = `${outputLabel}r${i}`;
		// A pitch-preserving stretch eats its own tail, so the slice is fed
		// past its span and the result trimmed back to the length the video
		// expects. The overhang is real audio from the next slice's territory,
		// which the trim then discards — padding with silence instead would
		// put a gap at every seam.
		const overhang = curve.preservePitch ? STRETCH_OVERHANG_SECONDS * segment.rate : 0;
		const inputEnd = Math.min(segment.end + overhang, duration).toFixed(6);

		const chain = [`atrim=start=${edges[i]}:end=${inputEnd}`, 'asetpts=PTS-STARTPTS'];
		chain.push(...retime(segment.rate));
		if (overhang > 0) {
			// The last slice has no neighbouring audio to overhang into, so it
			// comes back one flush short — 23ms, measured. `apad` covers only
			// what the overhang could not reach, and the trim below fixes the
			// length either way. Silence at the very end of a clip is not
			// something anyone hears; a clip that ends early is.
			chain.push(
				'apad',
				`atrim=start=0:end=${segment.outputDuration.toFixed(6)}`,
				'asetpts=PTS-STARTPTS'
			);
		}

		parts.push(`[${branches[i]}]${chain.join(',')}[${label}]`);
		retimed.push(label);
	});

	parts.push(
		`${retimed.map((l) => `[${l}]`).join('')}concat=n=${segments.length}:v=0:a=1[${outputLabel}]`
	);

	return parts;
}
