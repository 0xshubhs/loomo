import type { Clip, MosaicRegion, SpeedCurve } from '$lib/types/timeline.js';
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
