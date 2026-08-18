import { describe, it, expect, vi } from 'vitest';
import {
	countTiles,
	DEFAULT_UPSCALE_OPTIONS,
	postprocessTile,
	preprocessTile,
	upscaledSize,
	upscaleImage,
} from './upscale.js';
import { getModelSpec } from './model-registry.js';
import { AiToolError, type AiSession } from './runtime.js';
import { createImage, imageToNchw, readChwDims, type RgbaImage } from './tensor.js';

const SPEC = getModelSpec('realesrgan-x2plus')!;
const IDENTITY = { mean: SPEC.mean, std: SPEC.std };

/**
 * Stands in for Real-ESRGAN by doing an exact nearest-neighbour magnification.
 * A perfect upscaler makes seams and geometry bugs unambiguous — any deviation
 * in the output is the pipeline's fault, not the model's.
 */
function nearestNeighbourSession(scale: number, calls: { count: number } = { count: 0 }): AiSession {
	return {
		inputNames: [SPEC.input.name],
		outputNames: [SPEC.output.name],
		async run(feeds) {
			calls.count++;
			const input = Object.values(feeds)[0];
			const { height, width } = readChwDims(input.dims);
			const outWidth = width * scale;
			const outHeight = height * scale;
			const data = new Float32Array(3 * outWidth * outHeight);

			for (let c = 0; c < 3; c++) {
				for (let y = 0; y < outHeight; y++) {
					for (let x = 0; x < outWidth; x++) {
						const source = Math.floor(y / scale) * width + Math.floor(x / scale);
						data[c * outWidth * outHeight + y * outWidth + x] =
							input.data[c * width * height + source];
					}
				}
			}

			return {
				[SPEC.output.name]: { type: 'float32', data, dims: [1, 3, outHeight, outWidth] },
			};
		},
		async release() {},
	};
}

function gradientImage(width: number, height: number): RgbaImage {
	const image = createImage(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			image.data[i] = (x * 255) / Math.max(1, width - 1);
			image.data[i + 1] = (y * 255) / Math.max(1, height - 1);
			image.data[i + 2] = 128;
			image.data[i + 3] = 255;
		}
	}
	return image;
}

describe('upscaledSize', () => {
	it("should multiply both axes by the spec's scale", () => {
		expect(upscaledSize({ width: 640, height: 360 }, SPEC)).toEqual({ width: 1280, height: 720 });
	});

	it('should quadruple for the 4x model', () => {
		const x4 = getModelSpec('realesrgan-x4plus')!;
		expect(upscaledSize({ width: 100, height: 50 }, x4)).toEqual({ width: 400, height: 200 });
	});
});

describe('countTiles', () => {
	it('should be one tile for a frame smaller than the tile size', () => {
		expect(countTiles({ width: 200, height: 100 }, DEFAULT_UPSCALE_OPTIONS)).toBe(1);
	});

	it('should grow with frame size so callers can budget the run', () => {
		const small = countTiles({ width: 640, height: 360 }, DEFAULT_UPSCALE_OPTIONS);
		const large = countTiles({ width: 1920, height: 1080 }, DEFAULT_UPSCALE_OPTIONS);
		expect(large).toBeGreaterThan(small);
	});
});

describe('preprocessTile', () => {
	it('should emit an NCHW tensor sized to the tile', () => {
		const tensor = preprocessTile(createImage(64, 32), SPEC);
		expect(tensor.dims).toEqual([1, 3, 32, 64]);
	});

	it('should map pixels to 0-1 under the identity normalisation these models use', () => {
		const tensor = preprocessTile(createImage(1, 1, [255, 0, 0, 255]), SPEC);
		expect(tensor.data[0]).toBe(1);
		expect(tensor.data[1]).toBe(0);
	});
});

describe('postprocessTile', () => {
	it('should convert a 3-channel tensor back to pixels', () => {
		const source = createImage(2, 2, [10, 20, 30, 255]);
		const result = postprocessTile(imageToNchw(source, IDENTITY), SPEC, { width: 2, height: 2 });
		expect([...result.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
	});

	it('should reject a tensor that is not three channels', () => {
		expect(() =>
			postprocessTile({ data: new Float32Array(4), dims: [1, 1, 2, 2] }, SPEC, {
				width: 2,
				height: 2,
			})
		).toThrow(AiToolError);
	});

	it('should reject a tile that came back at the wrong magnification', () => {
		expect(() =>
			postprocessTile({ data: new Float32Array(12), dims: [1, 3, 2, 2] }, SPEC, {
				width: 4,
				height: 4,
			})
		).toThrow(/should scale to 4×4/);
	});
});

describe('upscaleImage', () => {
	it('should produce an image scaled by the spec', async () => {
		const result = await upscaleImage(gradientImage(40, 24), nearestNeighbourSession(2), SPEC);
		expect(result.width).toBe(80);
		expect(result.height).toBe(48);
		expect(result.data.length).toBe(80 * 48 * 4);
	});

	it('should run once per tile', async () => {
		const calls = { count: 0 };
		const image = gradientImage(600, 300);
		await upscaleImage(image, nearestNeighbourSession(2, calls), SPEC, {
			tileSize: 256,
			tileOverlap: 32,
		});
		expect(calls.count).toBe(countTiles(image, { tileSize: 256, tileOverlap: 32 }));
	});

	it('should leave no seam across tile joins on a flat image', async () => {
		const image = createImage(600, 300, [90, 140, 200, 255]);
		const result = await upscaleImage(image, nearestNeighbourSession(2), SPEC, {
			tileSize: 256,
			tileOverlap: 32,
		});

		// Collected rather than asserted per pixel: 720k assertions is slower
		// than the upscale itself.
		const reds = new Set<number>();
		const greens = new Set<number>();
		const blues = new Set<number>();
		for (let i = 0; i < result.data.length; i += 4) {
			reds.add(result.data[i]);
			greens.add(result.data[i + 1]);
			blues.add(result.data[i + 2]);
		}
		expect([...reds]).toEqual([90]);
		expect([...greens]).toEqual([140]);
		expect([...blues]).toEqual([200]);
	});

	it('should stay monotonic across tile joins on a gradient', async () => {
		// A horizontal gradient upscaled by a perfect model must never step
		// backwards; if it does, tiles were placed or blended wrongly.
		const result = await upscaleImage(gradientImage(600, 8), nearestNeighbourSession(2), SPEC, {
			tileSize: 256,
			tileOverlap: 32,
		});

		const row = 4 * result.width * 4;
		for (let x = 1; x < result.width; x++) {
			expect(result.data[row + x * 4]).toBeGreaterThanOrEqual(result.data[row + (x - 1) * 4] - 1);
		}
	});

	it('should carry alpha through even though the model is RGB-only', async () => {
		const image = createImage(40, 40, [255, 0, 0, 64]);
		const result = await upscaleImage(image, nearestNeighbourSession(2), SPEC);
		const alphas = new Set<number>();
		for (let i = 3; i < result.data.length; i += 4) alphas.add(result.data[i]);
		expect([...alphas]).toEqual([64]);
	});

	it('should report progress that ends at 1', async () => {
		const seen: number[] = [];
		await upscaleImage(gradientImage(600, 300), nearestNeighbourSession(2), SPEC, {
			tileSize: 256,
			tileOverlap: 32,
			onProgress: (fraction) => seen.push(fraction),
		});
		expect(seen.length).toBeGreaterThan(1);
		expect(seen[seen.length - 1]).toBe(1);
		expect([...seen].sort((a, b) => a - b)).toEqual(seen);
	});

	it('should stop when the signal is aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			upscaleImage(gradientImage(600, 300), nearestNeighbourSession(2), SPEC, {
				signal: controller.signal,
			})
		).rejects.toThrow(/cancelled/i);
	});

	it('should reject a model registered for another purpose', async () => {
		const matting = getModelSpec('u2netp')!;
		await expect(
			upscaleImage(createImage(8, 8), nearestNeighbourSession(2), matting)
		).rejects.toThrow(AiToolError);
	});

	it('should reject an empty frame', async () => {
		await expect(upscaleImage(createImage(0, 0), nearestNeighbourSession(2), SPEC)).rejects.toThrow(
			AiToolError
		);
	});

	it('should surface a model returning the wrong scale as a clear error', async () => {
		await expect(
			upscaleImage(createImage(16, 16), nearestNeighbourSession(4), SPEC)
		).rejects.toThrow(/should scale to/);
	});

	it('should propagate a session failure as a rejection', async () => {
		const session: AiSession = {
			inputNames: [SPEC.input.name],
			outputNames: [SPEC.output.name],
			run: vi.fn().mockRejectedValue(new Error('out of memory')),
			release: async () => {},
		};
		await expect(upscaleImage(createImage(16, 16), session, SPEC)).rejects.toThrow('out of memory');
	});
});
