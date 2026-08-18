import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAnnotationOverlays } from './ffmpeg-annotations.js';
import type { Annotation } from '$lib/types/annotations.js';

/**
 * Proves real FFmpeg accepts the annotation filtergraph.
 *
 * The unit tests inject a fake rasteriser and compare filter strings, which
 * says nothing about whether FFmpeg will parse the result. A generated graph
 * that looks correct and is rejected at export time is the exact failure this
 * project keeps hitting, so the binary gets the final word.
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

/** A 1x1 transparent PNG, scaled up by ffmpeg — stands in for a real drawing. */
const TRANSPARENT_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

function annotation(over: Partial<Annotation> = {}): Annotation {
	return {
		id: 'a1',
		type: 'pen',
		points: [
			{ x: 0.1, y: 0.1 },
			{ x: 0.5, y: 0.5 },
			{ x: 0.8, y: 0.3 },
		],
		color: '#ff3333',
		strokeWidth: 4,
		startTime: 0,
		endTime: 2,
		...over,
	} as Annotation;
}

describe.skipIf(!ffmpeg)('FFmpeg accepts the annotation filtergraph', () => {
	/**
	 * Runs the generated graph over a synthetic source, writing the rasterised
	 * PNGs to disk exactly as the export pipeline does.
	 */
	async function runGraph(annotations: Annotation[], width = 320, height = 240) {
		const dir = mkdtempSync(path.join(tmpdir(), 'loomo-ann-'));
		try {
			const overlays = await buildAnnotationOverlays(annotations, width, height, {
				inputLabel: '0:v',
				firstInputIndex: 1,
				// Node has no OffscreenCanvas; a real PNG of the right size is
				// all FFmpeg needs to exercise the graph.
				rasterise: async () => new Blob([TRANSPARENT_PNG], { type: 'image/png' }),
			});

			if (overlays.filters.length === 0) return { skipped: true, ok: true, stderr: '' };

			for (const image of overlays.images) {
				writeFileSync(path.join(dir, image.name), TRANSPARENT_PNG);
			}

			try {
				execFileSync(
					ffmpeg!,
					[
						'-hide_banner', '-nostdin',
						'-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=10:duration=3`,
						...overlays.inputArgs,
						'-filter_complex', overlays.filters.join(';'),
						'-map', `[${overlays.outputLabel}]`,
						'-frames:v', '20', '-f', 'null', '-',
					],
					{ cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
				);
				return { skipped: false, ok: true, stderr: '' };
			} catch (error: any) {
				return { skipped: false, ok: false, stderr: String(error.stderr ?? error.message) };
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it('renders a single timed annotation', async () => {
		const result = await runGraph([annotation()]);
		expect(result.skipped).toBe(false);
		if (!result.ok) throw new Error(result.stderr);
		expect(result.stderr).not.toMatch(/Error|Invalid/i);
	}, 60_000);

	it('renders several annotations sharing one time range', async () => {
		// One range means one image and one overlay, however many drawings.
		const result = await runGraph([
			annotation({ id: 'a', type: 'rect' }),
			annotation({ id: 'b', type: 'arrow' }),
			annotation({ id: 'c', type: 'ellipse' }),
		]);
		if (!result.ok) throw new Error(result.stderr);
		expect(result.ok).toBe(true);
	}, 60_000);

	it('chains overlays for annotations in different time ranges', async () => {
		const result = await runGraph([
			annotation({ id: 'a', startTime: 0, endTime: 1 }),
			annotation({ id: 'b', startTime: 1, endTime: 2 }),
			annotation({ id: 'c', startTime: 2, endTime: 3 }),
		]);
		if (!result.ok) throw new Error(result.stderr);
		expect(result.ok).toBe(true);
	}, 60_000);

    it('produces a graph at 4K without malformed dimensions', async () => {
		const result = await runGraph([annotation()], 3840, 2160);
		if (!result.ok) throw new Error(result.stderr);
		expect(result.ok).toBe(true);
	}, 90_000);

	it('emits no graph at all when nothing is drawable', async () => {
		// A zero-length range must not leave a dangling overlay node behind.
		const result = await runGraph([annotation({ startTime: 5, endTime: 5 })]);
		expect(result.skipped).toBe(true);
	}, 30_000);
});
