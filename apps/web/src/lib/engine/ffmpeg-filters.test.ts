import { describe, it, expect } from 'vitest';
import {
	buildVideoEffectFilters,
	buildMosaicSubgraph,
	buildDenoiseFilter,
	buildSpeedCurveSetpts,
	averageSpeed,
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

describe('buildSpeedCurveSetpts', () => {
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
	const point = (time: number, speed: number): SpeedPoint => ({ id: `p${time}`, time, speed });
	const curve = (points: SpeedPoint[]): SpeedCurve => ({ enabled: true, points, preservePitch: true });

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
