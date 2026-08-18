/**
 * Colourising black-and-white footage.
 *
 * These models work in CIELAB rather than RGB, and that choice is the whole
 * design: lightness is the one channel a greyscale frame already has, so the
 * network only ever predicts the two chroma channels and the original
 * lightness is put back untouched at full resolution. That is why a 256×256
 * model can colourise a 4K frame without softening it — only the colour is
 * low-resolution, and the eye barely notices.
 *
 * ## Cost
 * `colorizeImage` handles ONE frame, ~1.8 s on wasm. A 10-second 30 fps clip is
 * 300 frames, so roughly nine minutes, and colour decisions are made per frame
 * with no temporal smoothing — expect the palette to drift and flicker across a
 * shot. There is no whole-video entry point; that instability is a reason to
 * make the caller opt in frame by frame.
 */

import type { ModelSpec } from './model-registry.js';
import { AiToolError, resolveInputName, selectOutput, type AiSession } from './runtime.js';
import {
	readChwDims,
	resizeBilinear,
	resizePlaneBilinear,
	type FloatTensor,
	type RgbaImage,
} from './tensor.js';

export interface ColorizeOptions {
	/** 0 leaves the frame grey, 1 uses the model's chroma at full strength. */
	strength: number;
	signal?: AbortSignal;
}

export const DEFAULT_COLORIZE_OPTIONS: Omit<ColorizeOptions, 'signal'> = {
	strength: 1,
};

// D65 white point, matching the sRGB primaries used below.
const WHITE_X = 0.95047;
const WHITE_Y = 1.0;
const WHITE_Z = 1.08883;

// The CIE standard's rational constants, kept exact rather than rounded.
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

function srgbToLinear(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(linear: number): number {
	const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
	return Math.min(255, Math.max(0, Math.round(c * 255)));
}

/** sRGB (0-255) to CIELAB. L is 0-100; a and b are roughly -128..127. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
	const lr = srgbToLinear(r);
	const lg = srgbToLinear(g);
	const lb = srgbToLinear(b);

	const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / WHITE_X;
	const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / WHITE_Y;
	const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / WHITE_Z;

	const fx = pivot(x);
	const fy = pivot(y);
	const fz = pivot(z);

	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function pivot(t: number): number {
	return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/** CIELAB back to sRGB (0-255), clamped into gamut. */
export function labToRgb(l: number, a: number, b: number): [number, number, number] {
	const fy = (l + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;

	const x = unpivot(fx) * WHITE_X;
	const y = (l > KAPPA * EPSILON ? Math.pow(fy, 3) : l / KAPPA) * WHITE_Y;
	const z = unpivot(fz) * WHITE_Z;

	return [
		linearToSrgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
		linearToSrgb(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
		linearToSrgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
	];
}

function unpivot(f: number): number {
	const cubed = f * f * f;
	return cubed > EPSILON ? cubed : (116 * f - 16) / KAPPA;
}

/**
 * Flattens a frame to grey.
 *
 * Applied before inference even when the source already looks monochrome,
 * because a faded or sepia-toned scan still carries chroma that would fight
 * whatever the model predicts.
 */
export function toGrayscale(image: RgbaImage): RgbaImage {
	const out = new Uint8ClampedArray(image.data.length);
	for (let i = 0; i < image.data.length; i += 4) {
		const [l] = rgbToLab(image.data[i], image.data[i + 1], image.data[i + 2]);
		const [r, g, b] = labToRgb(l, 0, 0);
		out[i] = r;
		out[i + 1] = g;
		out[i + 2] = b;
		out[i + 3] = image.data[i + 3];
	}
	return { data: out, width: image.width, height: image.height };
}

/** Pulls the L channel out as a plane of 0-100 values. */
export function extractLightness(image: RgbaImage): Float32Array {
	const out = new Float32Array(image.width * image.height);
	for (let p = 0; p < out.length; p++) {
		const i = p * 4;
		out[p] = rgbToLab(image.data[i], image.data[i + 1], image.data[i + 2])[0];
	}
	return out;
}

/**
 * Builds the `1 × 1 × H × W` lightness tensor the network expects.
 *
 * Lightness is centred by subtracting 50 — the convention these checkpoints
 * were trained with. Skipping it does not error, it just yields washed-out
 * colour, which is the kind of bug that survives review.
 */
export function preprocessLightness(image: RgbaImage, spec: ModelSpec): FloatTensor {
	const resized = resizeBilinear(image, spec.input.width, spec.input.height);
	const lightness = extractLightness(resized);
	const data = new Float32Array(lightness.length);
	for (let i = 0; i < lightness.length; i++) data[i] = lightness[i] - 50;
	return { data, dims: [1, 1, spec.input.height, spec.input.width] };
}

export interface ChromaPlanes {
	a: Float32Array;
	b: Float32Array;
	width: number;
	height: number;
}

/** Splits the two-channel output and scales it up to the frame's resolution. */
export function postprocessChroma(
	output: FloatTensor,
	targetWidth: number,
	targetHeight: number
): ChromaPlanes {
	const { channels, width, height } = readChwDims(output.dims);
	if (channels !== 2) {
		throw new AiToolError(`Expected 2 chroma channels from the colouriser, got ${channels}.`);
	}

	const pixels = width * height;
	const a = output.data.subarray(0, pixels);
	const b = output.data.subarray(pixels, pixels * 2);

	return {
		a: resizePlaneBilinear(a, width, height, targetWidth, targetHeight),
		b: resizePlaneBilinear(b, width, height, targetWidth, targetHeight),
		width: targetWidth,
		height: targetHeight,
	};
}

/**
 * Recombines the frame's own lightness with predicted chroma.
 *
 * Lightness comes from `image` at full resolution rather than from the tensor,
 * so nothing the model does can soften the picture — only tint it.
 */
export function combineLightnessChroma(
	image: RgbaImage,
	chroma: ChromaPlanes,
	strength: number
): RgbaImage {
	const pixels = image.width * image.height;
	if (chroma.a.length !== pixels || chroma.b.length !== pixels) {
		throw new RangeError('Chroma planes do not match the frame size');
	}

	const amount = Math.min(1, Math.max(0, strength));
	const out = new Uint8ClampedArray(image.data.length);

	for (let p = 0; p < pixels; p++) {
		const i = p * 4;
		const [l] = rgbToLab(image.data[i], image.data[i + 1], image.data[i + 2]);
		const [r, g, b] = labToRgb(l, chroma.a[p] * amount, chroma.b[p] * amount);
		out[i] = r;
		out[i + 1] = g;
		out[i + 2] = b;
		out[i + 3] = image.data[i + 3];
	}

	return { data: out, width: image.width, height: image.height };
}

/** Colourises ONE frame. See the file header for what that costs on video. */
export async function colorizeImage(
	image: RgbaImage,
	session: AiSession,
	spec: ModelSpec,
	options: Partial<ColorizeOptions> = {}
): Promise<RgbaImage> {
	if (spec.purpose !== 'colorize') {
		throw new AiToolError(`Model "${spec.id}" is not a colourisation model.`);
	}
	if (image.width <= 0 || image.height <= 0) {
		throw new AiToolError('Cannot colourise an empty frame.');
	}

	const settings = { ...DEFAULT_COLORIZE_OPTIONS, ...options };
	const grey = toGrayscale(image);
	const feeds = {
		[resolveInputName(session, spec.input.name)]: {
			type: 'float32' as const,
			...preprocessLightness(grey, spec),
		},
	};

	if (settings.signal?.aborted) throw new AiToolError('Colourise cancelled.');

	const outputs = await session.run(feeds);
	const chroma = postprocessChroma(
		selectOutput(outputs, spec.output.name),
		image.width,
		image.height
	);

	return combineLightnessChroma(grey, chroma, settings.strength);
}
