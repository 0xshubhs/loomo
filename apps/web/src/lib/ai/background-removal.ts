/**
 * Cutting a subject out of a frame with a U²-Net / RMBG style matting model.
 *
 * The model does one thing: given a square RGB tensor it returns a
 * single-channel saliency map. Everything that makes the result usable —
 * rescaling the map back to the frame, gating it, softening the edge, turning
 * it into alpha — happens here, in plain array code with no ONNX involved.
 *
 * ## Cost
 * `removeBackground` handles ONE frame. There is no whole-video entry point on
 * purpose: at the Lite model's ~320 ms per frame on wasm, a 10-second 30 fps
 * clip is 300 inferences, roughly a minute and a half, and the caller is the
 * only one that can decide whether that is worth showing a progress bar for.
 * Loop over frames yourself and keep the session alive between them.
 */

import type { ModelSpec } from './model-registry.js';
import { AiToolError, resolveInputName, selectOutput, type AiSession } from './runtime.js';
import {
	imageToNchw,
	readChwDims,
	resizeBilinear,
	resizePlaneBilinear,
	type FloatTensor,
	type RgbaImage,
} from './tensor.js';

export interface MattingOptions {
	/** Mask values below this become fully transparent. 0 keeps the raw mask. */
	threshold: number;
	/** Radius in pixels of the edge softening pass. 0 disables it. */
	feather: number;
	/** Fill colour behind the subject, or null to leave the frame transparent. */
	background: readonly [number, number, number] | null;
}

export const DEFAULT_MATTING_OPTIONS: MattingOptions = {
	// Saliency maps are confident in the middle and mushy at the boundary; a
	// low gate clears the mush without eating into the subject.
	threshold: 0.2,
	feather: 2,
	background: null,
};

/** Scales the frame to the model's input size and packs it NCHW. */
export function preprocessFrame(image: RgbaImage, spec: ModelSpec): FloatTensor {
	const resized = resizeBilinear(image, spec.input.width, spec.input.height);
	return imageToNchw(resized, { mean: spec.mean, std: spec.std });
}

/**
 * Rescales a raw saliency map into 0-1.
 *
 * U²-Net's output is unbounded and its absolute range shifts from image to
 * image, so the published post-processing divides by the observed span rather
 * than clamping. A flat map (nothing salient found) would divide by zero, so
 * that case returns zeros — an empty cutout, which is the honest answer.
 */
export function normaliseMask(raw: Float32Array): Float32Array {
	let min = Infinity;
	let max = -Infinity;
	for (const value of raw) {
		if (value < min) min = value;
		if (value > max) max = value;
	}

	const span = max - min;
	const out = new Float32Array(raw.length);
	if (!Number.isFinite(span) || span <= 0) return out;

	for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - min) / span;
	return out;
}

/**
 * Gates weak mask values away and re-expands what is left over the full range,
 * so raising the threshold tightens the cutout instead of also making the
 * subject translucent.
 */
export function applyThreshold(mask: Float32Array, threshold: number): Float32Array {
	if (threshold <= 0) return new Float32Array(mask);
	if (threshold >= 1) return new Float32Array(mask.length);

	const out = new Float32Array(mask.length);
	const span = 1 - threshold;
	for (let i = 0; i < mask.length; i++) {
		const value = mask[i];
		out[i] = value <= threshold ? 0 : (value - threshold) / span;
	}
	return out;
}

/**
 * Softens the mask with two box-blur passes.
 *
 * Two passes approximate a Gaussian closely enough for an alpha edge at a
 * fraction of the cost, and the blur is separable, so this is O(w·h) per pass
 * regardless of radius. Without it, a thresholded mask composites with visibly
 * aliased stair-steps.
 */
export function featherMask(
	mask: Float32Array,
	width: number,
	height: number,
	radius: number
): Float32Array {
	if (mask.length !== width * height) {
		throw new RangeError(`Mask is ${mask.length} values, expected ${width * height}`);
	}
	const r = Math.floor(radius);
	if (r <= 0) return new Float32Array(mask);

	let current: Float32Array = new Float32Array(mask);
	for (let pass = 0; pass < 2; pass++) {
		current = boxBlurHorizontal(current, width, height, r);
		current = boxBlurVertical(current, width, height, r);
	}
	return current;
}

function boxBlurHorizontal(
	src: Float32Array,
	width: number,
	height: number,
	radius: number
): Float32Array {
	const out = new Float32Array(src.length);
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			let sum = 0;
			let count = 0;
			const from = Math.max(0, x - radius);
			const to = Math.min(width - 1, x + radius);
			for (let i = from; i <= to; i++) {
				sum += src[row + i];
				count++;
			}
			// Dividing by the clamped count rather than the full window keeps
			// borders at their own value instead of fading them towards zero.
			out[row + x] = sum / count;
		}
	}
	return out;
}

function boxBlurVertical(
	src: Float32Array,
	width: number,
	height: number,
	radius: number
): Float32Array {
	const out = new Float32Array(src.length);
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			let sum = 0;
			let count = 0;
			const from = Math.max(0, y - radius);
			const to = Math.min(height - 1, y + radius);
			for (let i = from; i <= to; i++) {
				sum += src[i * width + x];
				count++;
			}
			out[y * width + x] = sum / count;
		}
	}
	return out;
}

/**
 * Turns a mask into alpha on a copy of the frame.
 *
 * With no background colour the result is straight (non-premultiplied) alpha,
 * which is what canvas and every downstream compositor expect. With one, the
 * subject is blended over it and the result is fully opaque.
 *
 * The frame's own alpha is respected — a clip that was already partly
 * transparent does not become opaque just because the model was confident.
 */
export function compositeMask(
	image: RgbaImage,
	mask: Float32Array,
	background: readonly [number, number, number] | null = null
): RgbaImage {
	const pixels = image.width * image.height;
	if (mask.length !== pixels) {
		throw new RangeError(`Mask is ${mask.length} values, expected ${pixels}`);
	}

	const out = new Uint8ClampedArray(image.data.length);
	for (let p = 0; p < pixels; p++) {
		const i = p * 4;
		const alpha = Math.min(1, Math.max(0, mask[p]));

		if (background) {
			out[i] = Math.round(image.data[i] * alpha + background[0] * (1 - alpha));
			out[i + 1] = Math.round(image.data[i + 1] * alpha + background[1] * (1 - alpha));
			out[i + 2] = Math.round(image.data[i + 2] * alpha + background[2] * (1 - alpha));
			out[i + 3] = image.data[i + 3];
		} else {
			out[i] = image.data[i];
			out[i + 1] = image.data[i + 1];
			out[i + 2] = image.data[i + 2];
			out[i + 3] = Math.round(image.data[i + 3] * alpha);
		}
	}

	return { data: out, width: image.width, height: image.height };
}

/**
 * Full mask pipeline for one already-run inference: normalise, scale to the
 * frame, gate, feather. Split out from `removeBackground` so the numeric part
 * is testable without a session at all.
 */
export function buildMask(
	output: FloatTensor,
	targetWidth: number,
	targetHeight: number,
	options: MattingOptions
): Float32Array {
	const { channels, height, width } = readChwDims(output.dims);
	if (channels !== 1) {
		throw new AiToolError(`Expected a single-channel mask, got ${channels} channels.`);
	}

	const plane = output.data.subarray(0, width * height);
	const normalised = normaliseMask(plane);
	const scaled = resizePlaneBilinear(normalised, width, height, targetWidth, targetHeight);
	const gated = applyThreshold(scaled, options.threshold);
	return featherMask(gated, targetWidth, targetHeight, options.feather);
}

/**
 * Runs the matting model over ONE frame and returns the cutout.
 *
 * The session is a parameter rather than something created here so a caller
 * walking a clip pays the model-load cost once.
 */
export async function removeBackground(
	image: RgbaImage,
	session: AiSession,
	spec: ModelSpec,
	options: Partial<MattingOptions> = {}
): Promise<RgbaImage> {
	if (spec.purpose !== 'background-removal') {
		throw new AiToolError(`Model "${spec.id}" is not a background-removal model.`);
	}
	if (image.width <= 0 || image.height <= 0) {
		throw new AiToolError('Cannot remove the background from an empty frame.');
	}

	const settings = { ...DEFAULT_MATTING_OPTIONS, ...options };
	const input = preprocessFrame(image, spec);
	const feeds = {
		[resolveInputName(session, spec.input.name)]: { type: 'float32' as const, ...input },
	};

	const outputs = await session.run(feeds);
	const output = selectOutput(outputs, spec.output.name);
	const mask = buildMask(output, image.width, image.height, settings);

	return compositeMask(image, mask, settings.background);
}
