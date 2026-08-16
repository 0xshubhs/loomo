import { describe, it, expect } from 'vitest';
import {
	compileTrackExpr,
	compileOverlayExpr,
	compileRotationExpr,
	compileBrightnessExpr,
	compileAlphaCommands,
	quoteExpr,
} from './ffmpeg-keyframes.js';
import { evaluateTrack } from '$lib/utils/keyframes.js';
import type { EasingType, Keyframe, KeyframeTrack } from '$lib/types/keyframes.js';

/**
 * A miniature evaluator for the subset of FFmpeg expression syntax the
 * compiler emits.
 *
 * The point is to prove the compiled expression *means* the same thing as
 * `evaluateTrack`. Without this the two implementations could drift and the
 * only symptom would be an export that looks subtly different from the
 * preview — the sort of bug that is miserable to chase down later.
 */
function evalFFmpegExpr(source: string, vars: Record<string, number>): number {
	let pos = 0;

	const skipSpace = () => {
		while (pos < source.length && source[pos] === ' ') pos++;
	};

	function parseExpr(): number {
		let left = parseTerm();
		for (;;) {
			skipSpace();
			const op = source[pos];
			if (op !== '+' && op !== '-') return left;
			pos++;
			const right = parseTerm();
			left = op === '+' ? left + right : left - right;
		}
	}

	function parseTerm(): number {
		let left = parseFactor();
		for (;;) {
			skipSpace();
			const op = source[pos];
			if (op !== '*' && op !== '/') return left;
			pos++;
			const right = parseFactor();
			left = op === '*' ? left * right : left / right;
		}
	}

	function parseFactor(): number {
		skipSpace();
		if (source[pos] === '-') {
			pos++;
			return -parseFactor();
		}
		return parsePrimary();
	}

	function parseArgs(): number[] {
		const args: number[] = [];
		pos++; // consume '('
		for (;;) {
			args.push(parseExpr());
			skipSpace();
			if (source[pos] === ',') {
				pos++;
				continue;
			}
			if (source[pos] === ')') {
				pos++;
				return args;
			}
			throw new Error(`expected , or ) at ${pos} in ${source}`);
		}
	}

	function parsePrimary(): number {
		skipSpace();

		if (source[pos] === '(') {
			pos++;
			const value = parseExpr();
			skipSpace();
			if (source[pos] !== ')') throw new Error(`unbalanced paren at ${pos}`);
			pos++;
			return value;
		}

		const numberMatch = /^\d+(\.\d+)?/.exec(source.slice(pos));
		if (numberMatch) {
			pos += numberMatch[0].length;
			return parseFloat(numberMatch[0]);
		}

		const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
		if (!identMatch) throw new Error(`unexpected ${source[pos]} at ${pos} in ${source}`);
		const ident = identMatch[0];
		pos += ident.length;
		skipSpace();

		if (source[pos] === '(') {
			const args = parseArgs();
			switch (ident) {
				case 'if':
					return args[0] !== 0 ? args[1] : args[2];
				case 'lt':
					return args[0] < args[1] ? 1 : 0;
				case 'gt':
					return args[0] > args[1] ? 1 : 0;
				case 'min':
					return Math.min(args[0], args[1]);
				case 'max':
					return Math.max(args[0], args[1]);
				case 'pow':
					return Math.pow(args[0], args[1]);
				case 'trunc':
					return Math.trunc(args[0]);
				default:
					throw new Error(`unknown function ${ident}`);
			}
		}

		if (!(ident in vars)) throw new Error(`unknown variable ${ident}`);
		return vars[ident];
	}

	const result = parseExpr();
	skipSpace();
	if (pos !== source.length) throw new Error(`trailing input at ${pos} in ${source}`);
	return result;
}

let counter = 0;
function kf(time: number, value: number, easing: EasingType = 'linear'): Keyframe {
	return { id: `k${++counter}`, time, value, easing };
}

function track(keyframes: Keyframe[]): KeyframeTrack {
	return { property: 'scale', keyframes };
}

describe('the mini evaluator itself', () => {
	it('handles the constructs the compiler emits', () => {
		expect(evalFFmpegExpr('1+2*3', {})).toBe(7);
		expect(evalFFmpegExpr('(1+2)*3', {})).toBe(9);
		expect(evalFFmpegExpr('if(lt(t,5),10,20)', { t: 1 })).toBe(10);
		expect(evalFFmpegExpr('if(lt(t,5),10,20)', { t: 9 })).toBe(20);
		expect(evalFFmpegExpr('min(1,max(0,2))', {})).toBe(1);
		expect(evalFFmpegExpr('pow(3,2)', {})).toBe(9);
		expect(evalFFmpegExpr('-2*3', {})).toBe(-6);
	});
});

describe('compileTrackExpr', () => {
	it('returns null for an empty track', () => {
		expect(compileTrackExpr(undefined)).toBeNull();
		expect(compileTrackExpr(track([]))).toBeNull();
	});

	it('emits a bare constant for a single keyframe', () => {
		expect(compileTrackExpr(track([kf(0, 42)]))).toBe('42');
	});

	it.each<EasingType>(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'])(
		'matches evaluateTrack across a two-keyframe curve with %s easing',
		(easing) => {
			const t = track([kf(1, 0, easing), kf(3, 100, 'linear')]);
			const expr = compileTrackExpr(t)!;

			for (let time = 0; time <= 4; time += 0.05) {
				const expected = evaluateTrack(t, time)!;
				const actual = evalFFmpegExpr(expr, { t: time });
				expect(actual).toBeCloseTo(expected, 3);
			}
		}
	);

	it('matches evaluateTrack across a multi-segment curve with mixed easings', () => {
		const t = track([
			kf(0, 100, 'ease-out'),
			kf(1.5, 20, 'hold'),
			kf(2.5, 20, 'ease-in-out'),
			kf(4, 80, 'linear'),
			kf(5, 0, 'linear'),
		]);
		const expr = compileTrackExpr(t)!;

		for (let time = 0; time <= 6; time += 0.02) {
			expect(evalFFmpegExpr(expr, { t: time })).toBeCloseTo(evaluateTrack(t, time)!, 3);
		}
	});

	it('holds flat before the first and after the last keyframe', () => {
		const t = track([kf(2, 30), kf(4, 70)]);
		const expr = compileTrackExpr(t)!;
		expect(evalFFmpegExpr(expr, { t: 0 })).toBeCloseTo(30, 3);
		expect(evalFFmpegExpr(expr, { t: 1.9 })).toBeCloseTo(30, 3);
		expect(evalFFmpegExpr(expr, { t: 99 })).toBeCloseTo(70, 3);
	});

	it('tolerates unsorted input', () => {
		const sorted = compileTrackExpr(track([kf(0, 0), kf(2, 50)]));
		const unsorted = compileTrackExpr(track([kf(2, 50), kf(0, 0)]));
		expect(unsorted).toBe(sorted);
	});

	it('does not divide by zero when two keyframes share a time', () => {
		const expr = compileTrackExpr(track([kf(1, 0), kf(1, 100), kf(2, 200)]))!;
		for (let time = 0; time <= 3; time += 0.1) {
			expect(Number.isFinite(evalFFmpegExpr(expr, { t: time }))).toBe(true);
		}
	});

	it('applies the unit transform', () => {
		// Percent to ratio: 50% becomes 0.5.
		expect(compileTrackExpr(track([kf(0, 50)]), (v) => v / 100)).toBe('0.5');
	});
});

describe('per-property compilation', () => {
	it('centres overlay position and offsets by a fraction of the canvas', () => {
		const expr = compileOverlayExpr(track([kf(0, 0), kf(1, 50)]), 'x')!;
		// At t=0 the offset is zero, so the clip sits centred.
		expect(evalFFmpegExpr(expr, { t: 0, W: 1000, w: 200 })).toBeCloseTo(400, 3);
		// At t=1 it has moved half the canvas width to the right.
		expect(evalFFmpegExpr(expr, { t: 1, W: 1000, w: 200 })).toBeCloseTo(900, 3);
	});

	it('converts rotation degrees to radians', () => {
		const expr = compileRotationExpr(track([kf(0, 180)]))!;
		expect(evalFFmpegExpr(expr, {})).toBeCloseTo(Math.PI, 3);
	});

	it('maps brightness percent onto the eq offset range', () => {
		// 100% is neutral, 0% is fully dark, 200% is fully bright.
		expect(evalFFmpegExpr(compileBrightnessExpr(track([kf(0, 100)]))!, {})).toBeCloseTo(0, 3);
		expect(evalFFmpegExpr(compileBrightnessExpr(track([kf(0, 0)]))!, {})).toBeCloseTo(-1, 3);
		expect(evalFFmpegExpr(compileBrightnessExpr(track([kf(0, 200)]))!, {})).toBeCloseTo(1, 3);
	});
});

describe('compileAlphaCommands', () => {
	const opacity = track([kf(0, 0), kf(1, 100)]);
	const evaluate = (time: number) => evaluateTrack(opacity, time)!;

	it('returns null when there is nothing to animate', () => {
		expect(compileAlphaCommands(undefined, 1, 30, evaluate)).toBeNull();
		expect(compileAlphaCommands(track([]), 1, 30, evaluate)).toBeNull();
	});

	it('emits one sendcmd line per distinct value', () => {
		const script = compileAlphaCommands(opacity, 1, 10, evaluate)!;
		const lines = script.split('\n');
		expect(lines.length).toBeGreaterThan(5);
		for (const line of lines) {
			expect(line).toMatch(/^[\d.]+ colorchannelmixer@kf aa [\d.]+;$/);
		}
	});

	it('ramps from transparent to opaque', () => {
		const lines = compileAlphaCommands(opacity, 1, 10, evaluate)!.split('\n');
		expect(lines[0]).toContain('aa 0;');
		expect(lines[lines.length - 1]).toContain('aa 1;');
	});

	it('collapses runs of identical values', () => {
		const flat = track([kf(0, 50), kf(2, 50)]);
		const script = compileAlphaCommands(flat, 2, 30, (t) => evaluateTrack(flat, t)!)!;
		expect(script.split('\n')).toHaveLength(1);
	});
});

describe('quoteExpr', () => {
	it('wraps so embedded commas survive the filtergraph parser', () => {
		expect(quoteExpr('if(lt(t,1),0,1)')).toBe("'if(lt(t,1),0,1)'");
	});
});
