import { describe, it, expect } from 'vitest';
import {
	buildVideoEffectFilters,
	buildMosaicSubgraph,
	buildDenoiseFilter,
	buildSpeedCurveSetpts,
	buildSpeedCurveSegments,
	buildSpeedCurveAudioGraph,
	buildAtempoChain,
	averageSpeed,
	type SpeedSegment,
} from './ffmpeg-filters.js';
import type { MosaicRegion, SpeedCurve, SpeedPoint } from '$lib/types/timeline.js';
import { VIDEO_EFFECT_LIST } from '$lib/types/effects.js';

describe('buildVideoEffectFilters', () => {
	it('emits nothing when there is no effect', () => {
		expect(buildVideoEffectFilters(undefined)).toEqual([]);
		expect(buildVideoEffectFilters({ type: 'none', intensity: 50 })).toEqual([]);
	});

	it('covers every effect the UI offers', () => {
		// The preview and the export must not drift apart: if an effect appears
		// in the picker it has to produce filters here, or it vanishes on export.
		for (const { type } of VIDEO_EFFECT_LIST) {
			if (type === 'none') continue;
			const filters = buildVideoEffectFilters({ type, intensity: 60 });
			expect(filters.length, `${type} produced no filters`).toBeGreaterThan(0);
		}
	});

	it('scales with intensity', () => {
		const weak = buildVideoEffectFilters({ type: 'blur', intensity: 10 })[0];
		const strong = buildVideoEffectFilters({ type: 'blur', intensity: 100 })[0];
		expect(weak).toBe('gblur=sigma=1');
		expect(strong).toBe('gblur=sigma=10');
	});

	it('mirrors with hflip', () => {
		expect(buildVideoEffectFilters({ type: 'mirror', intensity: 50 })).toEqual(['hflip']);
	});

	it('quotes time-varying expressions so commas survive the parser', () => {
		const flash = buildVideoEffectFilters({ type: 'flash', intensity: 80 })[0];
		expect(flash).toContain("brightness='");
		expect(flash).toContain('eval=frame');
	});

	it('clamps intensity outside 0-100', () => {
		expect(buildVideoEffectFilters({ type: 'blur', intensity: -50 })[0]).toBe('gblur=sigma=0');
		expect(buildVideoEffectFilters({ type: 'blur', intensity: 500 })[0]).toBe('gblur=sigma=10');
	});
});

describe('buildDenoiseFilter', () => {
	it('is off at zero', () => {
		expect(buildDenoiseFilter(0)).toBeNull();
		expect(buildDenoiseFilter(-10)).toBeNull();
	});

	it('maps strength onto afftdn reduction', () => {
		expect(buildDenoiseFilter(100)).toBe('afftdn=nr=97:nf=-25');
		expect(buildDenoiseFilter(50)).toBe('afftdn=nr=48.5:nf=-25');
	});
});

describe('buildMosaicSubgraph', () => {
	const region = (over: Partial<MosaicRegion> = {}): MosaicRegion => ({
		id: 'm1',
		x: 10,
		y: 20,
		width: 30,
		height: 40,
		mode: 'pixelate',
		strength: 50,
		startTime: null,
		endTime: null,
		...over,
	});

	it('passes the stream through untouched when there are no regions', () => {
		expect(buildMosaicSubgraph('in', [], 1920, 1080, 'out')).toEqual(['[in]null[out]']);
	});

	it('splits, treats and recomposites a region', () => {
		const parts = buildMosaicSubgraph('in', [region()], 1920, 1080, 'out');
		const graph = parts.join(';');
		expect(graph).toContain('[in]split=2');
		expect(graph).toContain('crop=');
		expect(graph).toContain('flags=neighbor');
		expect(graph).toContain('overlay=');
		expect(graph).toContain('[out]');
	});

	it('uses a gaussian blur in blur mode', () => {
		const graph = buildMosaicSubgraph('in', [region({ mode: 'blur' })], 1920, 1080, 'out').join(';');
		expect(graph).toContain('gblur=sigma=');
		expect(graph).not.toContain('flags=neighbor');
	});

	it('keeps crop dimensions even and inside the frame', () => {
		const graph = buildMosaicSubgraph(
			'in',
			[region({ x: 95, y: 95, width: 50, height: 50 })],
			1920,
			1080,
			'out'
		).join(';');
		const crop = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(graph)!;
		const [w, h, x, y] = crop.slice(1).map(Number);
		expect(w % 2).toBe(0);
		expect(h % 2).toBe(0);
		expect(x + w).toBeLessThanOrEqual(1920);
		expect(y + h).toBeLessThanOrEqual(1080);
	});

	it('chains multiple regions so each feeds the next', () => {
		const parts = buildMosaicSubgraph('in', [region(), region({ id: 'm2', x: 50 })], 1920, 1080, 'out');
		const graph = parts.join(';');
		expect(graph).toContain('[in]split=2');
		// The first region's output label must be consumed by the second.
		expect(graph).toContain('[outm0]split=2');
		expect(graph).toContain('[out]');
	});

	it('gates a timed region with an enable expression', () => {
		const graph = buildMosaicSubgraph(
			'in',
			[region({ startTime: 1, endTime: 3 })],
			1920,
			1080,
			'out'
		).join(';');
		expect(graph).toContain("enable='between(t,1,3)'");
	});
});

const point = (time: number, speed: number): SpeedPoint => ({ id: `p${time}`, time, speed });
const curve = (points: SpeedPoint[]): SpeedCurve => ({ enabled: true, points, preservePitch: true });

/** Numerically integrates 1/speed so the closed form can be checked. */
function integrateNumerically(points: SpeedPoint[], until: number): number {
	const step = 0.0005;
	let total = 0;
	for (let t = 0; t < until; t += step) {
		total += step / speedAt(points, t + step / 2);
	}
	return total;
}

function speedAt(points: SpeedPoint[], t: number): number {
	if (t <= points[0].time) return points[0].speed;
	const last = points[points.length - 1];
	if (t >= last.time) return last.speed;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (t >= a.time && t <= b.time) {
			const p = (t - a.time) / (b.time - a.time);
			return a.speed + (b.speed - a.speed) * p;
		}
	}
	return last.speed;
}

/** Evaluates the emitted setpts expression, which uses `T` and `log`. */
function evalSetpts(filter: string, T: number): number {
	const inner = /^setpts='\((.*)\)\/TB'$/.exec(filter);
	if (!inner) throw new Error(`unexpected filter shape: ${filter}`);
	const js = inner[1]
		.replace(/\blog\(/g, 'Math.log(')
		.replace(/\bif\(/g, '__if(')
		.replace(/\blt\(/g, '__lt(');
	// eslint-disable-next-line no-new-func
	const fn = new Function(
		'T',
		'__if',
		'__lt',
		`return ${js};`
	);
	return fn(T, (c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a < b ? 1 : 0));
}

describe('buildSpeedCurveSetpts', () => {
	it('needs at least two points', () => {
		expect(buildSpeedCurveSetpts(curve([]))).toBeNull();
		expect(buildSpeedCurveSetpts(curve([point(0, 1)]))).toBeNull();
	});

	it('matches a plain constant rate', () => {
		const filter = buildSpeedCurveSetpts(curve([point(0, 2), point(4, 2)]))!;
		// At double speed, 4s of input becomes 2s of output.
		expect(evalSetpts(filter, 0)).toBeCloseTo(0, 4);
		expect(evalSetpts(filter, 2)).toBeCloseTo(1, 4);
		expect(evalSetpts(filter, 4)).toBeCloseTo(2, 4);
	});

	it('matches numeric integration across a ramp', () => {
		const points = [point(0, 1), point(4, 4)];
		const filter = buildSpeedCurveSetpts(curve(points))!;
		for (const t of [0.5, 1, 2, 3, 3.9]) {
			expect(evalSetpts(filter, t)).toBeCloseTo(integrateNumerically(points, t), 2);
		}
	});

	it('matches numeric integration across mixed segments', () => {
		const points = [point(0, 1), point(2, 0.5), point(5, 3), point(8, 3)];
		const filter = buildSpeedCurveSetpts(curve(points))!;
		for (const t of [0.5, 1.5, 2.5, 4, 6, 7.5]) {
			expect(evalSetpts(filter, t)).toBeCloseTo(integrateNumerically(points, t), 2);
		}
	});

	it('is monotonically increasing, so timestamps never go backwards', () => {
		const filter = buildSpeedCurveSetpts(curve([point(0, 0.25), point(3, 4), point(6, 0.5)]))!;
		let previous = -Infinity;
		for (let t = 0; t <= 7; t += 0.05) {
			const value = evalSetpts(filter, t);
			expect(value).toBeGreaterThan(previous);
			previous = value;
		}
	});

	it('survives a zero speed without dividing by zero', () => {
		const filter = buildSpeedCurveSetpts(curve([point(0, 0), point(2, 1)]))!;
		for (let t = 0; t <= 3; t += 0.1) {
			expect(Number.isFinite(evalSetpts(filter, t))).toBe(true);
		}
	});
});

describe('averageSpeed', () => {
	it('is the constant rate when the curve is flat', () => {
		expect(averageSpeed(curve([point(0, 2), point(4, 2)]))).toBeCloseTo(2, 4);
	});

	it('falls back to 1 for a degenerate curve', () => {
		expect(averageSpeed(curve([]))).toBe(1);
		expect(averageSpeed(curve([point(0, 3)]))).toBe(1);
	});

	it('lands between the extremes of a ramp', () => {
		const average = averageSpeed(curve([point(0, 1), point(4, 4)]));
		expect(average).toBeGreaterThan(1);
		expect(average).toBeLessThan(4);
	});
});

describe('buildSpeedCurveSegments', () => {
	/** Where a source time lands in the output once the slices have retimed it. */
	function audioOutputAt(segments: SpeedSegment[], t: number): number {
		let elapsed = 0;
		for (const segment of segments) {
			if (t >= segment.end) {
				elapsed += segment.outputDuration;
				continue;
			}
			if (t <= segment.start) return elapsed;
			return elapsed + (t - segment.start) / segment.rate;
		}
		return elapsed;
	}

	function totalOutput(segments: SpeedSegment[]): number {
		return segments.reduce((sum, s) => sum + s.outputDuration, 0);
	}

	const ramp = curve([point(0, 1), point(30, 4)]);
	const dip = curve([point(0, 1), point(2, 0.5), point(5, 3), point(8, 3)]);
	const swoop = curve([point(0, 0.25), point(3, 4), point(6, 0.5)]);

	it('produces nothing for a curve the export would ignore', () => {
		expect(buildSpeedCurveSegments(curve([]), 5)).toEqual([]);
		expect(buildSpeedCurveSegments(curve([point(0, 2)]), 5)).toEqual([]);
		expect(buildSpeedCurveSegments(ramp, 0)).toEqual([]);
	});

	it('covers the clip end to end, so no audio is dropped or played twice', () => {
		const segments = buildSpeedCurveSegments(dip, 8);
		expect(segments.length).toBeGreaterThan(1);
		expect(segments[0].start).toBeCloseTo(0, 6);
		expect(segments[segments.length - 1].end).toBeCloseTo(8, 6);
		for (let i = 1; i < segments.length; i++) {
			expect(segments[i].start).toBeCloseTo(segments[i - 1].end, 6);
		}
	});

	it('leaves a constant rate as a single slice, so a flat curve costs nothing', () => {
		const segments = buildSpeedCurveSegments(curve([point(0, 2), point(6, 2)]), 6);
		expect(segments).toHaveLength(1);
		expect(segments[0].rate).toBeCloseTo(2, 6);
		expect(segments[0].outputDuration).toBeCloseTo(3, 6);
	});

	it('ends on exactly the output length the video setpts produces', () => {
		// The one property that must hold: if these two disagree the exported
		// audio runs past the picture or stops short of it.
		for (const [c, duration] of [[ramp, 30], [dip, 8], [swoop, 6]] as const) {
			const videoEnd = evalSetpts(buildSpeedCurveSetpts(c)!, duration);
			expect(totalOutput(buildSpeedCurveSegments(c, duration))).toBeCloseTo(videoEnd, 6);
		}
	});

	it('matches the video length when the curve stops before the clip does', () => {
		// Past the last point the last speed continues; the audio has to make the
		// same assumption the setpts expression does or the tail runs long.
		const short = curve([point(0, 1), point(4, 2)]);
		const videoEnd = evalSetpts(buildSpeedCurveSetpts(short)!, 12);
		const segments = buildSpeedCurveSegments(short, 12);
		expect(segments[segments.length - 1].end).toBeCloseTo(12, 6);
		expect(totalOutput(segments)).toBeCloseTo(videoEnd, 6);
	});

	it('keeps every slice on the exact integral, so error cannot accumulate', () => {
		const segments = buildSpeedCurveSegments(ramp, 30);
		let elapsed = 0;
		for (const segment of segments) {
			elapsed += segment.outputDuration;
			expect(elapsed).toBeCloseTo(integrateNumerically(ramp.points, segment.end), 2);
			expect(segment.rate).toBeCloseTo((segment.end - segment.start) / segment.outputDuration, 9);
		}
	});

	it('holds the audio within a few milliseconds of the picture throughout', () => {
		for (const [c, duration] of [[ramp, 30], [dip, 8], [swoop, 6]] as const) {
			const setpts = buildSpeedCurveSetpts(c)!;
			const segments = buildSpeedCurveSegments(c, duration);
			let worst = 0;
			for (let t = 0; t <= duration; t += duration / 400) {
				worst = Math.max(worst, Math.abs(audioOutputAt(segments, t) - evalSetpts(setpts, t)));
			}
			expect(worst, `drifted ${(worst * 1000).toFixed(1)}ms`).toBeLessThan(0.006);
		}
	});

	it('beats the single average rate it replaces by two orders of magnitude', () => {
		// Negative control for the bug this exists to fix: stretching a 30s ramp
		// by its mean puts the audio the better part of a second out of step.
		const setpts = buildSpeedCurveSetpts(ramp)!;
		const mean = averageSpeed(ramp);
		let worst = 0;
		for (let t = 0; t <= 30; t += 0.1) {
			worst = Math.max(worst, Math.abs(t / mean - evalSetpts(setpts, t)));
		}
		expect(worst).toBeGreaterThan(0.5);
	});

	it('stays inside the graph ceiling on a punishing curve', () => {
		// Ten minutes of continuous ramping is the worst case a user can build;
		// the graph has to stay a size FFmpeg will accept.
		const points = [];
		for (let i = 0; i <= 60; i++) {
			points.push(point(i * 10, i % 2 === 0 ? 0.25 : 4));
		}
		const segments = buildSpeedCurveSegments(curve(points), 600);
		expect(segments.length).toBeLessThanOrEqual(256);
		// Coarser slices still have to end in the right place.
		const videoEnd = evalSetpts(buildSpeedCurveSetpts(curve(points))!, 600);
		expect(segments.reduce((s, x) => s + x.outputDuration, 0)).toBeCloseTo(videoEnd, 4);
	});

	it('never cuts a ramp finer than atempo can retime', () => {
		const segments = buildSpeedCurveSegments(curve([point(0, 0.1), point(20, 5)]), 20);
		for (const segment of segments) {
			expect(segment.end - segment.start).toBeGreaterThanOrEqual(0.05 - 1e-9);
		}
	});

	it('survives a zero speed without producing an infinite rate', () => {
		const segments = buildSpeedCurveSegments(curve([point(0, 0), point(2, 1)]), 2);
		expect(segments.length).toBeGreaterThan(0);
		for (const segment of segments) {
			expect(Number.isFinite(segment.rate)).toBe(true);
			expect(segment.rate).toBeGreaterThan(0);
			expect(Number.isFinite(segment.outputDuration)).toBe(true);
		}
	});
});

describe('buildAtempoChain', () => {
	function product(parts: string[]): number {
		return parts.reduce((acc, p) => acc * Number(p.slice('atempo='.length)), 1);
	}

	it('emits nothing at normal speed', () => {
		expect(buildAtempoChain(1)).toEqual([]);
		expect(buildAtempoChain(1.0000001)).toEqual([]);
	});

	it('multiplies out to the requested rate without leaving the 0.5-2.0 limit', () => {
		for (const rate of [0.02, 0.25, 0.5, 0.73, 1.2, 2, 3.7, 8, 100]) {
			const parts = buildAtempoChain(rate);
			for (const part of parts) {
				const value = Number(part.slice('atempo='.length));
				expect(value, `${part} is outside what atempo accepts`).toBeGreaterThanOrEqual(0.5);
				expect(value).toBeLessThanOrEqual(2);
			}
			expect(product(parts) / rate).toBeCloseTo(1, 5);
		}
	});
});

describe('buildSpeedCurveAudioGraph', () => {
	function labels(part: string, side: 'in' | 'out'): string[] {
		const match = side === 'in' ? /^(\[[^\]]+\])+/.exec(part) : /(\[[^\]]+\])+$/.exec(part);
		if (!match) return [];
		return match[0].slice(1, -1).split('][');
	}

	it('passes audio through untouched when there is no curve to follow', () => {
		expect(buildSpeedCurveAudioGraph('a0pre', curve([]), 5, 'a0')).toEqual(['[a0pre]anull[a0]']);
	});

	it('collapses to a plain chain when one rate covers the clip', () => {
		const parts = buildSpeedCurveAudioGraph('a0pre', curve([point(0, 2), point(4, 2)]), 4, 'a0');
		expect(parts).toHaveLength(1);
		expect(parts[0]).toBe('[a0pre]atempo=2.000000[a0]');
	});

	it('splits, trims, retimes and concatenates one branch per slice', () => {
		const c = curve([point(0, 1), point(6, 3)]);
		const count = buildSpeedCurveSegments(c, 6).length;
		expect(count).toBeGreaterThan(1);

		const parts = buildSpeedCurveAudioGraph('a0pre', c, 6, 'a0');
		expect(parts[0]).toContain(`asplit=${count}`);
		expect(parts[parts.length - 1]).toContain(`concat=n=${count}:v=0:a=1[a0]`);
		expect(parts.filter((p) => p.includes('atrim='))).toHaveLength(count);
		expect(parts.filter((p) => p.includes('asetpts=PTS-STARTPTS'))).toHaveLength(count);
	});

	it('wires every label to exactly one consumer, so FFmpeg accepts the graph', () => {
		// An unconsumed or doubly-consumed label is a graph error rather than a
		// wrong-sounding export, so it is worth checking structurally.
		const parts = buildSpeedCurveAudioGraph('a0pre', curve([point(0, 0.5), point(9, 4)]), 9, 'a0');
		const produced = new Map<string, number>();
		const consumed = new Map<string, number>();
		const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

		for (const part of parts) {
			for (const l of labels(part, 'in')) bump(consumed, l);
			for (const l of labels(part, 'out')) bump(produced, l);
		}

		expect(consumed.get('a0pre')).toBe(1);
		expect(produced.has('a0pre')).toBe(false);
		expect(produced.get('a0')).toBe(1);
		expect(consumed.has('a0')).toBe(false);
		for (const [label, times] of produced) {
			if (label === 'a0') continue;
			expect(times, `${label} produced ${times} times`).toBe(1);
			expect(consumed.get(label), `${label} consumed ${consumed.get(label)} times`).toBe(1);
		}
	});

	it('cuts neighbouring slices at an identical boundary string', () => {
		// A rounded gap between one slice's end and the next slice's start would
		// silently drop or repeat samples at every seam.
		const parts = buildSpeedCurveAudioGraph('a0pre', curve([point(0, 1), point(7, 2.5)]), 7, 'a0');
		const trims = parts
			.map((p) => /atrim=start=([^:]+):end=([^,\]]+)/.exec(p))
			.filter((m): m is RegExpExecArray => m !== null);
		expect(trims.length).toBeGreaterThan(1);
		for (let i = 1; i < trims.length; i++) {
			expect(trims[i][1]).toBe(trims[i - 1][2]);
		}
	});
});
