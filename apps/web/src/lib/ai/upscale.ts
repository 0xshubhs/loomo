/**
 * Real-ESRGAN style 2×/4× upscaling.
 *
 * The interesting part is not the inference, it is the tiling. These models run
 * at a fixed input size and their activation memory grows with the square of
 * it, so a 1080p frame cannot go through in one piece — it is cut into
 * overlapping tiles, each tile is upscaled, and the results are feathered back
 * together. Do that naively and the output has a visible grid; `TileBlender`
 * exists to stop that.
 *
 * ## Cost
 * `upscaleImage` handles ONE frame, and it runs the model once per tile: a
 * 1920×1080 frame at a 256 px tile is 45 inferences, so around two minutes on
 * wasm for a *single* frame. Upscaling video with this is a batch job, not
 * something to run behind a spinner — there is deliberately no whole-clip
 * entry point.
 */

import type { ModelSpec } from './model-registry.js';
import { AiToolError, resolveInputName, selectOutput, type AiSession } from './runtime.js';
import {
	cropImage,
	imageToNchw,
	nchwToImage,
	planTiles,
	readChwDims,
	resizeBilinear,
	TileBlender,
	type FloatTensor,
	type RgbaImage,
} from './tensor.js';

export interface UpscaleOptions {
	/** Source-space tile edge in pixels. Larger is faster but uses more memory. */
	tileSize: number;
	/** How far tiles overlap, in source pixels. Also the blend width. */
	tileOverlap: number;
	/** Called with 0-1 after each tile, so a long run can show real progress. */
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
}

export const DEFAULT_UPSCALE_OPTIONS: Omit<UpscaleOptions, 'onProgress' | 'signal'> = {
	tileSize: 256,
	// 32 px is enough context for the model to agree with its neighbour across
	// the join, without inflating the tile count much.
	tileOverlap: 32,
};

/** Output dimensions for a given model, so callers can budget memory first. */
export function upscaledSize(
	image: { width: number; height: number },
	spec: ModelSpec
): { width: number; height: number } {
	return { width: image.width * spec.scale, height: image.height * spec.scale };
}

/** How many inferences a frame will cost at these settings. */
export function countTiles(
	image: { width: number; height: number },
	options: Pick<UpscaleOptions, 'tileSize' | 'tileOverlap'>
): number {
	return planTiles(image.width, image.height, options.tileSize, options.tileOverlap).length;
}

export function preprocessTile(tile: RgbaImage, spec: ModelSpec): FloatTensor {
	return imageToNchw(tile, { mean: spec.mean, std: spec.std });
}

/**
 * Turns an upscaled tile tensor back into pixels, checking the model actually
 * delivered the promised magnification. A 4× model handed to a 2× spec would
 * otherwise silently produce a misaligned mosaic.
 */
export function postprocessTile(
	output: FloatTensor,
	spec: ModelSpec,
	expected: { width: number; height: number }
): RgbaImage {
	const { channels, width, height } = readChwDims(output.dims);
	if (channels !== 3) {
		throw new AiToolError(`Expected a 3-channel image from the upscaler, got ${channels}.`);
	}
	if (width !== expected.width || height !== expected.height) {
		throw new AiToolError(
			`Model "${spec.id}" returned ${width}×${height} for a tile that should scale to ${expected.width}×${expected.height}.`
		);
	}
	return nchwToImage(output, { mean: spec.mean, std: spec.std });
}

/**
 * Upscales ONE frame.
 *
 * Alpha is carried across by plain bilinear resampling rather than through the
 * model — Real-ESRGAN is RGB-only, and dropping alpha would quietly turn a
 * background-removal result back into a rectangle.
 */
export async function upscaleImage(
	image: RgbaImage,
	session: AiSession,
	spec: ModelSpec,
	options: Partial<UpscaleOptions> = {}
): Promise<RgbaImage> {
	if (spec.purpose !== 'upscale') {
		throw new AiToolError(`Model "${spec.id}" is not an upscaling model.`);
	}
	if (image.width <= 0 || image.height <= 0) {
		throw new AiToolError('Cannot upscale an empty frame.');
	}

	const settings = { ...DEFAULT_UPSCALE_OPTIONS, ...options };
	const scale = spec.scale;
	const target = upscaledSize(image, spec);

	const tiles = planTiles(image.width, image.height, settings.tileSize, settings.tileOverlap);
	const inputName = resolveInputName(session, spec.input.name);
	const blender = new TileBlender(target.width, target.height, settings.tileOverlap * scale);

	for (let index = 0; index < tiles.length; index++) {
		if (options.signal?.aborted) throw new AiToolError('Upscale cancelled.');

		const tile = tiles[index];
		const patch = cropImage(image, tile);
		const feeds = {
			[inputName]: { type: 'float32' as const, ...preprocessTile(patch, spec) },
		};

		const outputs = await session.run(feeds);
		const upscaled = postprocessTile(selectOutput(outputs, spec.output.name), spec, {
			width: patch.width * scale,
			height: patch.height * scale,
		});

		blender.add(upscaled, tile.x * scale, tile.y * scale);
		options.onProgress?.((index + 1) / tiles.length);
	}

	const result = blender.finish();
	const alpha = resizeBilinear(image, target.width, target.height);
	for (let i = 3; i < result.data.length; i += 4) result.data[i] = alpha.data[i];

	return result;
}
