import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	compileScaleExpr,
	compileOverlayExpr,
	compileRotationExpr,
	compileBrightnessExpr,
	compileRatioExpr,
	compileAlphaCommands,
	quoteExpr,
} from './ffmpeg-keyframes.js';
import { evaluateTrack } from '$lib/utils/keyframes.js';
import type { Keyframe, KeyframeTrack, AnimatableProperty } from '$lib/types/keyframes.js';

/**
 * Proves real FFmpeg accepts what the compiler emits.
 *
 * The unit tests show the expressions mean the right thing; they cannot show
 * that FFmpeg will parse them. Filtergraph quoting and per-filter `eval=frame`
 * support are exactly the kind of thing that looks fine and then fails at
 * export time, so these run the actual binary.
 */

const BUNDLED = path.resolve(
	__dirname,
	'../../../../desktop/src-tauri/binaries/loomo-ffmpeg-x86_64-unknown-linux-gnu'
);

function resolveFfmpeg(): string | null {
	if (existsSync(BUNDLED)) return BUNDLED;
	try {
		execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
		return 'ffmpeg';
	} catch {
		return null;
	}
}

const ffmpeg = resolveFfmpeg();

/** Runs a filtergraph against a synthetic source, returning FFmpeg's stderr on failure. */
function runGraph(filterComplex: string, extraArgs: string[] = []): { ok: boolean; stderr: string } {
	try {
		execFileSync(
			ffmpeg!,
			[
				'-hide_banner',
				'-nostdin',
				'-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=2',
				'-f', 'lavfi', '-i', 'color=c=black:size=640x480:rate=10:duration=2',
				'-filter_complex', filterComplex,
				...extraArgs,
				'-frames:v', '20',
				'-f', 'null', '-',
			],
			{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
		);
		return { ok: true, stderr: '' };
	} catch (error: any) {
		return { ok: false, stderr: String(error.stderr ?? error.message) };
	}
}

let counter = 0;
function kf(time: number, value: number): Keyframe {
	return { id: `k${++counter}`, time, value, easing: 'ease-in-out' };
}
function track(property: AnimatableProperty, keyframes: Keyframe[]): KeyframeTrack {
	return { property, keyframes };
}

describe.skipIf(!ffmpeg)('FFmpeg accepts compiled keyframe expressions', () => {
	it('animates scale with eval=frame', () => {
		const t = track('scale', [kf(0, 50), kf(2, 150)]);
		const w = compileScaleExpr(t, 'iw')!;
		const h = compileScaleExpr(t, 'ih')!;
		const result = runGraph(
			`[0:v]scale=w=${quoteExpr(w)}:h=${quoteExpr(h)}:eval=frame[v]`,
			['-map', '[v]']
		);
		expect(result.stderr).not.toMatch(/Error|Invalid|failed/i);
		expect(result.ok).toBe(true);
	});

	it('animates rotation', () => {
		const angle = compileRotationExpr(track('rotation', [kf(0, 0), kf(2, 360)]))!;
		const result = runGraph(`[0:v]rotate=${quoteExpr(angle)}:c=none[v]`, ['-map', '[v]']);
		expect(result.stderr).not.toMatch(/Error|Invalid|failed/i);
		expect(result.ok).toBe(true);
	});

	it('animates overlay position over a canvas', () => {
		const x = compileOverlayExpr(track('positionX', [kf(0, -25), kf(2, 25)]), 'x')!;
		const y = compileOverlayExpr(track('positionY', [kf(0, 0), kf(2, 10)]), 'y')!;
		const result = runGraph(
			`[1:v][0:v]overlay=x=${quoteExpr(x)}:y=${quoteExpr(y)}[v]`,
			['-map', '[v]']
		);
		expect(result.stderr).not.toMatch(/Error|Invalid|failed/i);
		expect(result.ok).toBe(true);
	});

	it('animates eq colour terms with eval=frame', () => {
		const brightness = compileBrightnessExpr(track('brightness', [kf(0, 50), kf(2, 150)]))!;
		const saturation = compileRatioExpr(track('saturation', [kf(0, 0), kf(2, 200)]))!;
		const result = runGraph(
			`[0:v]eq=brightness=${quoteExpr(brightness)}:saturation=${quoteExpr(saturation)}:eval=frame[v]`,
			['-map', '[v]']
		);
		expect(result.stderr).not.toMatch(/Error|Invalid|failed/i);
		expect(result.ok).toBe(true);
	});

	it('animates audio volume with eval=frame', () => {
		const volume = compileRatioExpr(track('volume', [kf(0, 0), kf(2, 100)]))!;
		try {
			execFileSync(
				ffmpeg!,
				[
					'-hide_banner', '-nostdin',
					'-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
					'-af', `volume=${quoteExpr(volume)}:eval=frame`,
					'-f', 'null', '-',
				],
				{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
			);
		} catch (error: any) {
			throw new Error(`volume expression rejected: ${error.stderr}`);
		}
	});

	it('drives opacity through a generated sendcmd script', () => {
		const opacity = track('opacity', [kf(0, 0), kf(2, 100)]);
		const script = compileAlphaCommands(opacity, 2, 10, (time) => evaluateTrack(opacity, time)!)!;

		const dir = mkdtempSync(path.join(tmpdir(), 'loomo-kf-'));
		const scriptPath = path.join(dir, 'alpha.cmd');
		writeFileSync(scriptPath, script);

		// sendcmd needs the target filter tagged with the same @kf label the
		// script addresses.
		const graph =
			`[0:v]format=yuva420p,sendcmd=filename=${scriptPath},colorchannelmixer@kf=aa=1[fg];` +
			`[1:v][fg]overlay[v]`;
		const result = runGraph(graph, ['-map', '[v]']);
		expect(result.stderr).not.toMatch(/Error|Invalid|failed/i);
		expect(result.ok).toBe(true);
	});

	it('survives a full chain: crop, scale, rotate, eq, overlay', () => {
		const scaleTrack = track('scale', [kf(0, 80), kf(2, 120)]);
		const graph =
			`[0:v]crop=iw*0.9:ih*0.9,` +
			`scale=w=${quoteExpr(compileScaleExpr(scaleTrack, 'iw')!)}:h=${quoteExpr(compileScaleExpr(scaleTrack, 'ih')!)}:eval=frame,` +
			`rotate=${quoteExpr(compileRotationExpr(track('rotation', [kf(0, 0), kf(2, 45)]))!)}:c=none,` +
			`eq=brightness=${quoteExpr(compileBrightnessExpr(track('brightness', [kf(0, 90), kf(2, 110)]))!)}:eval=frame[fg];` +
			`[1:v][fg]overlay=x=${quoteExpr(compileOverlayExpr(track('positionX', [kf(0, -10), kf(2, 10)]), 'x')!)}:y=(H-h)/2[v]`;
		const result = runGraph(graph, ['-map', '[v]']);
		expect(result.stderr).not.toMatch(/Error|Invalid|failed/i);
		expect(result.ok).toBe(true);
	});
});
