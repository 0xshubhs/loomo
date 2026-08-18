import { describe, it, expect } from 'vitest';
import {
	buildAnnotationOverlays,
	groupAnnotationsByRange,
	hasAnnotationOverlays,
	isExportableAnnotation,
	type AnnotationRasteriser,
} from './ffmpeg-annotations.js';
import { createAnnotation } from '$lib/types/annotations.js';
import type { Annotation, AnnotationType } from '$lib/types/annotations.js';

let nextId = 0;

function make(
	startTime: number,
	endTime: number,
	overrides: Partial<Annotation> = {},
	type: AnnotationType = 'pen'
): Annotation {
	return createAnnotation({
		id: `a${nextId++}`,
		type,
		points: [
			{ x: 0.1, y: 0.1 },
			{ x: 0.9, y: 0.9 },
		],
		startTime,
		endTime,
		...overrides,
	});
}

/**
 * Records what it was asked to rasterise and hands back a stub blob.
 *
 * OffscreenCanvas does not exist under Node, and the graph is what these tests
 * are about — the pixels are covered by annotation-render.test.ts.
 */
function stubRasteriser(): AnnotationRasteriser & { calls: { annotations: Annotation[]; width: number; height: number }[] } {
	const calls: { annotations: Annotation[]; width: number; height: number }[] = [];
	const fn = async (annotations: Annotation[], width: number, height: number) => {
		calls.push({ annotations, width, height });
		return new Blob([`${annotations.length}`], { type: 'image/png' });
	};
	return Object.assign(fn, { calls });
}

describe('isExportableAnnotation', () => {
	it('accepts a normal annotation', () => {
		expect(isExportableAnnotation(make(1, 4))).toBe(true);
	});

	it('rejects one with no points, which would render a blank image', () => {
		expect(isExportableAnnotation(make(1, 4, { points: [] }))).toBe(false);
	});

	it('rejects a zero-length range, which `between` can never satisfy', () => {
		expect(isExportableAnnotation(make(2, 2))).toBe(false);
	});

	it('rejects an inverted range', () => {
		expect(isExportableAnnotation(make(6, 2))).toBe(false);
	});

	it('rejects a range that clamping collapses to nothing', () => {
		// Dragged entirely before zero: FFmpeg's clock starts at 0, so there is
		// no window left after trimming.
		expect(isExportableAnnotation(make(-5, -1))).toBe(false);
	});

	it('reports whether a timeline has anything to burn in', () => {
		expect(hasAnnotationOverlays([])).toBe(false);
		expect(hasAnnotationOverlays([make(2, 2)])).toBe(false);
		expect(hasAnnotationOverlays([make(2, 2), make(0, 1)])).toBe(true);
	});
});

describe('groupAnnotationsByRange', () => {
	it('gives one group per distinct range', () => {
		const groups = groupAnnotationsByRange([make(0, 2), make(0, 2), make(3, 5)]);
		expect(groups).toHaveLength(2);
		expect(groups[0].annotations).toHaveLength(2);
		expect(groups[1].annotations).toHaveLength(1);
	});

	it('does not merge ranges that share only a start or only an end', () => {
		const groups = groupAnnotationsByRange([make(0, 2), make(0, 4), make(1, 4)]);
		expect(groups.map((g) => [g.startTime, g.endTime])).toEqual([
			[0, 2],
			[0, 4],
			[1, 4],
		]);
	});

	it('orders groups by start then end, whatever order they were drawn in', () => {
		const groups = groupAnnotationsByRange([make(9, 10), make(1, 3), make(1, 2)]);
		expect(groups.map((g) => g.startTime)).toEqual([1, 1, 9]);
		expect(groups.map((g) => g.endTime)).toEqual([2, 3, 10]);
	});

	it('trims a negative start to zero and groups it with an already-clamped one', () => {
		const groups = groupAnnotationsByRange([make(-2, 4), make(0, 4)]);
		expect(groups).toHaveLength(1);
		expect(groups[0].startTime).toBe(0);
	});

	it('drops everything unexportable', () => {
		expect(groupAnnotationsByRange([make(2, 2), make(1, 4, { points: [] })])).toEqual([]);
	});

	it('keeps draw order within a group', () => {
		const first = make(0, 2, { color: '#111111' });
		const second = make(0, 2, { color: '#222222' });
		const groups = groupAnnotationsByRange([first, second]);
		expect(groups[0].annotations.map((a) => a.color)).toEqual(['#111111', '#222222']);
	});
});

describe('buildAnnotationOverlays', () => {
	it('returns an inert result and the untouched label when there is nothing to draw', async () => {
		const result = await buildAnnotationOverlays([], 1920, 1080, {
			inputLabel: 'outv',
			rasterise: stubRasteriser(),
		});
		expect(result).toEqual({ filters: [], images: [], inputArgs: [], outputLabel: 'outv' });
	});

	it('does the same when every annotation is unexportable', async () => {
		const result = await buildAnnotationOverlays([make(3, 3), make(0, 1, { points: [] })], 1920, 1080, {
			inputLabel: 'cap2',
			rasterise: stubRasteriser(),
		});
		expect(result.filters).toEqual([]);
		expect(result.images).toEqual([]);
		expect(result.outputLabel).toBe('cap2');
	});

	it('composites one overlay per range, gated on time', async () => {
		const result = await buildAnnotationOverlays([make(1, 4.5)], 1920, 1080, {
			inputLabel: 'outv',
			firstInputIndex: 3,
			rasterise: stubRasteriser(),
		});
		expect(result.filters).toEqual([
			"[outv][3:v]overlay=0:0:eof_action=repeat:enable='between(t,1,4.5)'[ann0]",
		]);
		expect(result.outputLabel).toBe('ann0');
	});

	it('chains ranges through successive labels', async () => {
		const result = await buildAnnotationOverlays([make(0, 2), make(4, 6)], 1920, 1080, {
			inputLabel: 'outv',
			firstInputIndex: 2,
			rasterise: stubRasteriser(),
		});
		expect(result.filters).toEqual([
			"[outv][2:v]overlay=0:0:eof_action=repeat:enable='between(t,0,2)'[ann0]",
			"[ann0][3:v]overlay=0:0:eof_action=repeat:enable='between(t,4,6)'[ann1]",
		]);
		expect(result.outputLabel).toBe('ann1');
	});

	it('numbers inputs from where the clip inputs left off', async () => {
		const result = await buildAnnotationOverlays([make(0, 2), make(4, 6)], 1920, 1080, {
			firstInputIndex: 7,
			rasterise: stubRasteriser(),
		});
		expect(result.filters[0]).toContain('[7:v]');
		expect(result.filters[1]).toContain('[8:v]');
	});

	it('picks up the graph from wherever the caller left it', async () => {
		const result = await buildAnnotationOverlays([make(0, 2)], 1920, 1080, {
			inputLabel: 'shp1',
			rasterise: stubRasteriser(),
		});
		expect(result.filters[0].startsWith('[shp1]')).toBe(true);
	});

	it('emits one -i per image, in the order the filters reference them', async () => {
		const result = await buildAnnotationOverlays([make(0, 2), make(4, 6)], 1920, 1080, {
			firstInputIndex: 1,
			rasterise: stubRasteriser(),
		});
		expect(result.images.map((i) => i.name)).toEqual(['ann_0.png', 'ann_1.png']);
		expect(result.inputArgs).toEqual(['-i', 'ann_0.png', '-i', 'ann_1.png']);
	});

	it('rasterises at the export resolution, once per range', async () => {
		const rasterise = stubRasteriser();
		await buildAnnotationOverlays([make(0, 2), make(0, 2), make(4, 6)], 3840, 2160, { rasterise });

		expect(rasterise.calls).toHaveLength(2);
		expect(rasterise.calls[0].annotations).toHaveLength(2);
		expect(rasterise.calls[1].annotations).toHaveLength(1);
		for (const call of rasterise.calls) {
			expect(call.width).toBe(3840);
			expect(call.height).toBe(2160);
		}
	});

	it('clamps a negative start into the enable window', async () => {
		const result = await buildAnnotationOverlays([make(-3, 2)], 1920, 1080, {
			rasterise: stubRasteriser(),
		});
		expect(result.filters[0]).toContain("enable='between(t,0,2)'");
	});

	it('rounds long float times so the graph stays readable and stable', async () => {
		const result = await buildAnnotationOverlays([make(0.1 + 0.2, 1 / 3)], 1920, 1080, {
			rasterise: stubRasteriser(),
		});
		expect(result.filters[0]).toContain("enable='between(t,0.3,0.3333)'");
	});

	it('honours a label prefix so it cannot collide with other overlay stages', async () => {
		const result = await buildAnnotationOverlays([make(0, 2)], 1920, 1080, {
			labelPrefix: 'draw',
			rasterise: stubRasteriser(),
		});
		expect(result.images[0].name).toBe('draw_0.png');
		expect(result.outputLabel).toBe('draw0');
	});

	it('produces a PNG blob per range', async () => {
		const result = await buildAnnotationOverlays([make(0, 2)], 640, 360, {
			rasterise: stubRasteriser(),
		});
		expect(result.images[0].blob.type).toBe('image/png');
	});
});
