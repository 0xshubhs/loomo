import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	buildVideoEffectFilters,
	buildMosaicSubgraph,
	buildDenoiseFilter,
	buildSpeedCurveSetpts,
} from './ffmpeg-filters.js';
import { VIDEO_EFFECT_LIST } from '$lib/types/effects.js';
import type { MosaicRegion, SpeedPoint } from '$lib/types/timeline.js';

/**
 * Runs every generated filter through the real binary.
 *
 * These filters are assembled as strings, so a stray comma or an option a
 * filter does not actually support produces something that looks plausible and
 * only fails when a user exports. Running them here catches that at test time.
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

function runVideoFilter(chain: string): { ok: boolean; stderr: string } {
	try {
		execFileSync(
			ffmpeg!,
			[
				'-hide_banner', '-nostdin',
				'-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=1',
				'-vf', chain,
				'-frames:v', '8',
				'-f', 'null', '-',
			],
			{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
		);
		return { ok: true, stderr: '' };
	} catch (error: any) {
		return { ok: false, stderr: String(error.stderr ?? error.message) };
	}
}

function runComplex(graph: string, map: string): { ok: boolean; stderr: string } {
	try {
		execFileSync(
			ffmpeg!,
			[
				'-hide_banner', '-nostdin',
				'-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=1',
				'-filter_complex', graph,
				'-map', map,
				'-frames:v', '8',
				'-f', 'null', '-',
			],
			{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
		);
		return { ok: true, stderr: '' };
	} catch (error: any) {
		return { ok: false, stderr: String(error.stderr ?? error.message) };
	}
}

describe.skipIf(!ffmpeg)('FFmpeg accepts generated filters', () => {
	// Every effect in the picker, at a few intensities — this is the check that
	// would have caught Motion FX never reaching the exporter.
	const effects = VIDEO_EFFECT_LIST.filter((e) => e.type !== 'none');

	it.each(effects.map((e) => e.type))('renders the %s effect', (type) => {
		for (const intensity of [1, 50, 100]) {
			const chain = buildVideoEffectFilters({ type, intensity }).join(',');
			expect(chain, `${type} produced an empty chain`).not.toBe('');
			const result = runVideoFilter(chain);
			if (!result.ok) {
				throw new Error(`${type} @ ${intensity} rejected:\n${chain}\n${result.stderr}`);
			}
		}
	});

	it('renders a pixelate mosaic', () => {
		const region: MosaicRegion = {
			id: 'm1', x: 10, y: 10, width: 30, height: 30,
			mode: 'pixelate', strength: 60, startTime: null, endTime: null,
		};
		const graph = buildMosaicSubgraph('0:v', [region], 320, 240, 'out').join(';');
		const result = runComplex(graph, '[out]');
		expect(result.stderr).not.toMatch(/Error|Invalid/i);
		expect(result.ok).toBe(true);
	});

	it('renders a blur mosaic limited to a time range', () => {
		const region: MosaicRegion = {
			id: 'm1', x: 40, y: 40, width: 25, height: 25,
			mode: 'blur', strength: 80, startTime: 0.2, endTime: 0.6,
		};
		const graph = buildMosaicSubgraph('0:v', [region], 320, 240, 'out').join(';');
		const result = runComplex(graph, '[out]');
		expect(result.stderr).not.toMatch(/Error|Invalid/i);
		expect(result.ok).toBe(true);
	});

	it('renders several stacked mosaic regions', () => {
		const regions: MosaicRegion[] = [
			{ id: 'a', x: 5, y: 5, width: 20, height: 20, mode: 'pixelate', strength: 40, startTime: null, endTime: null },
			{ id: 'b', x: 50, y: 30, width: 25, height: 25, mode: 'blur', strength: 70, startTime: null, endTime: null },
			{ id: 'c', x: 70, y: 70, width: 20, height: 20, mode: 'pixelate', strength: 90, startTime: null, endTime: null },
		];
		const graph = buildMosaicSubgraph('0:v', regions, 320, 240, 'out').join(';');
		const result = runComplex(graph, '[out]');
		expect(result.stderr).not.toMatch(/Error|Invalid/i);
		expect(result.ok).toBe(true);
	});

	it('applies the audio denoiser', () => {
		const filter = buildDenoiseFilter(70)!;
		try {
			execFileSync(
				ffmpeg!,
				[
					'-hide_banner', '-nostdin',
					'-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
					'-af', filter,
					'-f', 'null', '-',
				],
				{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
			);
		} catch (error: any) {
			throw new Error(`denoise rejected: ${filter}\n${error.stderr}`);
		}
	});

	it('applies a speed-curve setpts expression', () => {
		const points: SpeedPoint[] = [
			{ id: 'a', time: 0, speed: 1 },
			{ id: 'b', time: 0.5, speed: 3 },
			{ id: 'c', time: 1, speed: 0.5 },
		];
		const filter = buildSpeedCurveSetpts({ enabled: true, points, preservePitch: true })!;
		const result = runVideoFilter(filter);
		if (!result.ok) throw new Error(`setpts rejected:\n${filter}\n${result.stderr}`);
		expect(result.ok).toBe(true);
	});
});
