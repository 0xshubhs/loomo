/**
 * Freehand drawings over the video frame.
 *
 * Annotations belong to the timeline rather than to a clip: a circle drawn
 * around something on screen usually spans a cut, and re-parenting it every
 * time the underlying clip is split or moved would lose it.
 */

export type AnnotationType = 'pen' | 'arrow' | 'rect' | 'ellipse' | 'highlighter';

/**
 * A point on the frame as a fraction of its size.
 *
 * Pixels would bind a stroke to whatever the preview panel happened to measure
 * when it was drawn — usually a few hundred pixels wide — and the same stroke
 * would land in the wrong place, at the wrong scale, in a 4K export.
 */
export interface AnnotationPoint {
	/** 0..1 across the frame width. */
	x: number;
	/** 0..1 down the frame height. */
	y: number;
}

export interface Annotation {
	id: string;
	type: AnnotationType;
	/**
	 * `pen` and `highlighter` carry the whole traced path. `arrow` is
	 * [tail, head]. `rect` and `ellipse` are two opposite corners of the
	 * bounding box, in either order.
	 */
	points: AnnotationPoint[];
	color: string;
	/** Pixels at {@link ANNOTATION_REFERENCE_HEIGHT}; see that constant. */
	strokeWidth: number;
	/** Seconds on the timeline, not within a clip. */
	startTime: number;
	endTime: number;
}

/**
 * Stroke widths are stored against a 1080p frame and scaled at draw time.
 *
 * The alternative — storing the raw pixel width used in the preview — makes
 * every line hairline-thin in a 4K export and chunky in a small preview, the
 * same resolution dependence that normalised points exist to avoid.
 */
export const ANNOTATION_REFERENCE_HEIGHT = 1080;

/** Highlighter reads as ink on top of the picture, not paint over it. */
export const HIGHLIGHTER_ALPHA = 0.35;

/** A highlighter nib is far broader than a pen at the same nominal width. */
export const HIGHLIGHTER_WIDTH_SCALE = 4;

/** Seconds a freshly drawn annotation stays on screen. */
export const DEFAULT_ANNOTATION_DURATION = 3;

export const DEFAULT_ANNOTATION_COLOR = '#ff3b30';

export const DEFAULT_ANNOTATION_STROKE_WIDTH = 6;

/**
 * Drawing settings shared by the tool picker and the drawing surface.
 *
 * Held by whichever component owns both of them so the two stay in step; it is
 * a plain mutable object, so a `$state` instance passed to both propagates
 * edits in either direction without `bind:`.
 */
export interface AnnotationToolState {
	/** `null` disarms the drawing surface entirely. */
	tool: AnnotationType | null;
	color: string;
	strokeWidth: number;
	/** Seconds the next annotation will last. */
	duration: number;
}

export function createAnnotationToolState(): AnnotationToolState {
	return {
		tool: null,
		color: DEFAULT_ANNOTATION_COLOR,
		strokeWidth: DEFAULT_ANNOTATION_STROKE_WIDTH,
		duration: DEFAULT_ANNOTATION_DURATION,
	};
}

export const ANNOTATION_TOOLS: { type: AnnotationType; label: string }[] = [
	{ type: 'pen', label: 'Pen' },
	{ type: 'arrow', label: 'Arrow' },
	{ type: 'rect', label: 'Rect' },
	{ type: 'ellipse', label: 'Ellipse' },
	{ type: 'highlighter', label: 'Marker' },
];

type CreateAnnotationInput = Pick<Annotation, 'id' | 'type' | 'points'> &
	Partial<Omit<Annotation, 'id' | 'type' | 'points'>>;

/**
 * Builds an annotation with every field defaulted.
 *
 * Mirrors `createClip`: call sites that spell the object out drift away from
 * the type as fields are added.
 */
export function createAnnotation(input: CreateAnnotationInput): Annotation {
	const startTime = input.startTime ?? 0;
	return {
		id: input.id,
		type: input.type,
		points: input.points,
		color: input.color ?? DEFAULT_ANNOTATION_COLOR,
		strokeWidth: input.strokeWidth ?? DEFAULT_ANNOTATION_STROKE_WIDTH,
		startTime,
		endTime: input.endTime ?? startTime + DEFAULT_ANNOTATION_DURATION,
	};
}
