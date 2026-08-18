import type { Annotation } from '$lib/types/annotations.js';
import { drawAnnotation } from '$lib/utils/annotation-render.js';

/**
 * Annotations compiled into an FFmpeg filtergraph.
 *
 * Strokes are freeform paths, and there is no FFmpeg filter that draws one —
 * `drawbox` handles axis-aligned rectangles and nothing else. So each distinct
 * time range is rasterised once to a full-frame transparent PNG using the same
 * canvas code the preview draws with, and composited with `overlay`. One image
 * per range rather than per annotation keeps the input count down: a session
 * with forty strokes across three ranges costs three extra inputs.
 *
 * Nothing here touches the filesystem or the FFmpeg engine — it returns filter
 * strings and blobs, and the caller writes them. See `buildAnnotationOverlays`
 * for the wiring.
 */

export interface AnnotationImage {
	/** Filename to write into the FFmpeg working directory. */
	name: string;
	blob: Blob;
}

export interface AnnotationOverlays {
	/** Filtergraph segments, to append to `filterParts`. */
	filters: string[];
	images: AnnotationImage[];
	/** `-i` arguments for the rasterised PNGs, in input-index order. */
	inputArgs: string[];
	/**
	 * Label carrying the composited video. Equal to the input label when there
	 * was nothing to draw, so callers can assign it unconditionally.
	 */
	outputLabel: string;
}

/** Rasterises one time range's annotations to a full-frame transparent PNG. */
export type AnnotationRasteriser = (
	annotations: Annotation[],
	width: number,
	height: number
) => Promise<Blob>;

export interface AnnotationOverlayOptions {
	/** Graph label holding the video to draw on. */
	inputLabel?: string;
	/**
	 * Index the first annotation PNG will take as an FFmpeg input — i.e. the
	 * number of `-i` arguments already on the command line.
	 */
	firstInputIndex?: number;
	labelPrefix?: string;
	/** Overridable so the graph can be built without a canvas implementation. */
	rasterise?: AnnotationRasteriser;
}

export interface AnnotationGroup {
	startTime: number;
	endTime: number;
	annotations: Annotation[];
}

function n(value: number): string {
	return Number(value.toFixed(4)).toString();
}

/**
 * Annotations that will actually appear in the render.
 *
 * A range that ends at or before it starts can never satisfy `between`, and an
 * annotation with no points draws nothing — both would cost an input and an
 * overlay pass for a fully transparent image.
 */
export function isExportableAnnotation(annotation: Annotation): boolean {
	if (annotation.points.length === 0) return false;
	const start = Math.max(0, annotation.startTime);
	return annotation.endTime > start;
}

export function hasAnnotationOverlays(annotations: Annotation[]): boolean {
	return annotations.some(isExportableAnnotation);
}

/**
 * Buckets annotations by their visible range so each range needs one image.
 *
 * Ranges are ordered by start time to keep the generated graph stable — the
 * tests compare filter strings, and so does anything caching a render.
 */
export function groupAnnotationsByRange(annotations: Annotation[]): AnnotationGroup[] {
	const groups = new Map<string, AnnotationGroup>();

	for (const annotation of annotations) {
		if (!isExportableAnnotation(annotation)) continue;
		// Negative starts come from an annotation dragged before zero; FFmpeg's
		// clock starts at 0, so the range is trimmed rather than dropped.
		const startTime = Math.max(0, annotation.startTime);
		const endTime = annotation.endTime;
		const key = `${startTime}:${endTime}`;
		const existing = groups.get(key);
		if (existing) {
			existing.annotations.push(annotation);
		} else {
			groups.set(key, { startTime, endTime, annotations: [annotation] });
		}
	}

	return [...groups.values()].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}

async function rasteriseToPng(
	annotations: Annotation[],
	width: number,
	height: number
): Promise<Blob> {
	if (typeof OffscreenCanvas === 'undefined') {
		throw new Error('Annotation export needs OffscreenCanvas, which this environment lacks');
	}
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not acquire a 2D context to rasterise annotations');

	for (const annotation of annotations) {
		drawAnnotation(ctx, annotation, width, height);
	}

	// PNG rather than JPEG: the untouched parts of the frame must stay transparent.
	return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Compiles annotations into overlay filters plus the PNGs they reference.
 *
 * Wire into `exportFilterComplex` (export-pipeline.ts), immediately after the
 * shape-overlay loop and before `-filter_complex` is pushed:
 *
 * ```ts
 * const anno = await buildAnnotationOverlays(annotations, width, height, { inputLabel: videoOut, firstInputIndex: inputPaths.length });
 * for (const img of anno.images) await ffmpeg.writeFile(img.name, await img.blob.arrayBuffer());
 * if (anno.filters.length > 0) { args.push(...anno.inputArgs); filterParts.push(...anno.filters); videoOut = anno.outputLabel; }
 * ```
 *
 * The image names should also join the `cleanup` list, and
 * `hasAnnotationOverlays(annotations)` belongs in the `hasEffects` test that
 * chooses strategy C — without it a timeline whose only edit is a drawing takes
 * the stream-copy path and exports without it.
 */
export async function buildAnnotationOverlays(
	annotations: Annotation[],
	width: number,
	height: number,
	options: AnnotationOverlayOptions = {}
): Promise<AnnotationOverlays> {
	const inputLabel = options.inputLabel ?? 'outv';
	const firstInputIndex = options.firstInputIndex ?? 0;
	const prefix = options.labelPrefix ?? 'ann';
	const rasterise = options.rasterise ?? rasteriseToPng;

	const groups = groupAnnotationsByRange(annotations);
	const result: AnnotationOverlays = {
		filters: [],
		images: [],
		inputArgs: [],
		outputLabel: inputLabel,
	};
	if (groups.length === 0) return result;

	for (let i = 0; i < groups.length; i++) {
		const group = groups[i];
		const name = `${prefix}_${i}.png`;
		const nextLabel = `${prefix}${i}`;
		const inputIndex = firstInputIndex + i;

		result.images.push({ name, blob: await rasterise(group.annotations, width, height) });
		result.inputArgs.push('-i', name);
		// eof_action=repeat holds the single PNG frame for the whole clip;
		// without it the overlay stops at the image's one-frame duration.
		result.filters.push(
			`[${result.outputLabel}][${inputIndex}:v]overlay=0:0:eof_action=repeat` +
				`:enable='between(t,${n(group.startTime)},${n(group.endTime)})'[${nextLabel}]`
		);
		result.outputLabel = nextLabel;
	}

	return result;
}
