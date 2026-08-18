import { describe, it, expect, vi } from 'vitest';
import {
	applyThreshold,
	buildMask,
	compositeMask,
	DEFAULT_MATTING_OPTIONS,
	featherMask,
	normaliseMask,
	preprocessFrame,
	removeBackground,
} from './background-removal.js';
import { getModelSpec } from './model-registry.js';
import { AiToolError, type AiSession, type AiTensor } from './runtime.js';
import { createImage, type RgbaImage } from './tensor.js';

const SPEC = getModelSpec('u2netp')!;

/**
 * A session that returns a fixed mask. Everything about the tools is testable
 * this way — no model file, no wasm, no network.
 */
function maskSession(
	mask: Float32Array,
	dims: number[],
	options: { outputName?: string; inputNames?: string[] } = {}
): AiSession & { feeds: Record<string, AiTensor>[] } {
	const feeds: Record<string, AiTensor>[] = [];
	return {
		feeds,
		inputNames: options.inputNames ?? [SPEC.input.name],
		outputNames: [options.outputName ?? SPEC.output.name],
		async run(given) {
			feeds.push(given);
			return { [options.outputName ?? SPEC.output.name]: { type: 'float32', data: mask, dims } };
		},
		async release() {},
	};
}

function flatMask(value: number): Float32Array {
	return new Float32Array(SPEC.output.width * SPEC.output.height).fill(value);
}

/** Left half salient, right half not, at the model's output resolution. */
function halfMask(): Float32Array {
	const { width, height } = SPEC.output;
	const mask = new Float32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) mask[y * width + x] = x < width / 2 ? 1 : 0;
	}
	return mask;
}

describe('preprocessFrame', () => {
	it('should resize the frame to the model input size', () => {
		const tensor = preprocessFrame(createImage(640, 360, [10, 20, 30, 255]), SPEC);
		expect(tensor.dims).toEqual([1, 3, SPEC.input.height, SPEC.input.width]);
	});

	it("should apply the spec's normalisation", () => {
		const tensor = preprocessFrame(createImage(4, 4, [255, 255, 255, 255]), SPEC);
		expect(tensor.data[0]).toBeCloseTo((1 - SPEC.mean[0]) / SPEC.std[0], 5);
	});

	it('should place the green plane after every red value', () => {
		const pixels = SPEC.input.width * SPEC.input.height;
		const tensor = preprocessFrame(createImage(8, 8, [255, 0, 0, 255]), SPEC);
		const red = (1 - SPEC.mean[0]) / SPEC.std[0];
		const green = (0 - SPEC.mean[1]) / SPEC.std[1];
		expect(tensor.data[0]).toBeCloseTo(red, 5);
		expect(tensor.data[pixels]).toBeCloseTo(green, 5);
	});
});

describe('normaliseMask', () => {
	it('should stretch an arbitrary range onto 0-1', () => {
		const result = normaliseMask(new Float32Array([-3, 0, 5]));
		expect(result[0]).toBe(0);
		expect(result[2]).toBe(1);
		expect(result[1]).toBeCloseTo(3 / 8, 6);
	});

	it('should return zeros for a flat map rather than dividing by zero', () => {
		const result = normaliseMask(new Float32Array([2, 2, 2]));
		expect([...result]).toEqual([0, 0, 0]);
		expect(result.every(Number.isFinite)).toBe(true);
	});

	it('should handle an empty map', () => {
		expect(normaliseMask(new Float32Array(0)).length).toBe(0);
	});

	it('should never produce a value outside 0-1', () => {
		const result = normaliseMask(new Float32Array([-100, -1, 0.3, 7, 40]));
		for (const value of result) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});
});

describe('applyThreshold', () => {
	it('should be a copy when the threshold is zero', () => {
		const mask = new Float32Array([0, 0.5, 1]);
		const result = applyThreshold(mask, 0);
		expect([...result]).toEqual([0, 0.5, 1]);
		expect(result).not.toBe(mask);
	});

	it('should zero everything at or below the threshold', () => {
		const result = applyThreshold(new Float32Array([0.1, 0.5, 0.9]), 0.5);
		expect(result[0]).toBe(0);
		expect(result[1]).toBe(0);
		expect(result[2]).toBeGreaterThan(0);
	});

	it('should re-expand the surviving range so full opacity stays reachable', () => {
		const result = applyThreshold(new Float32Array([0.5, 0.75, 1]), 0.5);
		expect(result[1]).toBeCloseTo(0.5, 6);
		expect(result[2]).toBe(1);
	});

	it('should clear the whole mask at a threshold of 1', () => {
		expect([...applyThreshold(new Float32Array([0.99, 1]), 1)]).toEqual([0, 0]);
	});
});

describe('featherMask', () => {
	it('should be an identity for a zero radius', () => {
		const mask = new Float32Array([0, 1, 0, 1]);
		expect([...featherMask(mask, 4, 1, 0)]).toEqual([0, 1, 0, 1]);
	});

	it('should leave a constant mask unchanged', () => {
		const result = featherMask(new Float32Array(64).fill(0.6), 8, 8, 3);
		for (const value of result) expect(value).toBeCloseTo(0.6, 5);
	});

	it('should turn a hard edge into a gradient', () => {
		const width = 16;
		const mask = new Float32Array(width);
		for (let x = 0; x < width; x++) mask[x] = x < 8 ? 1 : 0;

		const result = featherMask(mask, width, 1, 3);
		expect(result[7]).toBeLessThan(1);
		expect(result[8]).toBeGreaterThan(0);
		// Still monotonic — feathering must not ring or overshoot.
		for (let x = 1; x < width; x++) expect(result[x]).toBeLessThanOrEqual(result[x - 1] + 1e-6);
	});

	it('should keep values within 0-1', () => {
		const mask = new Float32Array(100);
		for (let i = 0; i < mask.length; i++) mask[i] = i % 2;
		for (const value of featherMask(mask, 10, 10, 2)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	it('should reject a mask that does not match its dimensions', () => {
		expect(() => featherMask(new Float32Array(5), 3, 3, 1)).toThrow(RangeError);
	});
});

describe('compositeMask', () => {
	it('should write the mask into alpha and leave colour alone', () => {
		const image = createImage(2, 1, [10, 20, 30, 255]);
		const result = compositeMask(image, new Float32Array([1, 0]));
		expect([...result.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
		expect([...result.data.slice(4, 8)]).toEqual([10, 20, 30, 0]);
	});

	it('should produce straight alpha, not premultiplied', () => {
		const result = compositeMask(createImage(1, 1, [200, 200, 200, 255]), new Float32Array([0.5]));
		expect(result.data[0]).toBe(200);
		expect(result.data[3]).toBe(128);
	});

	it("should respect the frame's existing alpha", () => {
		const result = compositeMask(createImage(1, 1, [10, 10, 10, 128]), new Float32Array([1]));
		expect(result.data[3]).toBe(128);
	});

	it('should blend over a background colour and stay opaque', () => {
		const result = compositeMask(
			createImage(1, 1, [200, 0, 0, 255]),
			new Float32Array([0.5]),
			[0, 0, 100]
		);
		expect(result.data[0]).toBe(100);
		expect(result.data[2]).toBe(50);
		expect(result.data[3]).toBe(255);
	});

	it('should clamp mask values outside 0-1', () => {
		const result = compositeMask(createImage(2, 1, [1, 1, 1, 255]), new Float32Array([-2, 5]));
		expect(result.data[3]).toBe(0);
		expect(result.data[7]).toBe(255);
	});

	it('should reject a mask of the wrong length', () => {
		expect(() => compositeMask(createImage(2, 2), new Float32Array(3))).toThrow(RangeError);
	});

	it('should not mutate the source frame', () => {
		const image = createImage(1, 1, [10, 10, 10, 255]);
		compositeMask(image, new Float32Array([0]));
		expect(image.data[3]).toBe(255);
	});
});

describe('buildMask', () => {
	it('should return one value per pixel of the target frame', () => {
		const mask = buildMask(
			{ data: halfMask(), dims: [1, 1, SPEC.output.height, SPEC.output.width] },
			64,
			32,
			DEFAULT_MATTING_OPTIONS
		);
		expect(mask.length).toBe(64 * 32);
	});

	it('should keep the salient side opaque and the other side clear', () => {
		const mask = buildMask(
			{ data: halfMask(), dims: [1, 1, SPEC.output.height, SPEC.output.width] },
			64,
			1,
			{ threshold: 0.2, feather: 0, background: null }
		);
		expect(mask[0]).toBeCloseTo(1, 3);
		expect(mask[63]).toBeCloseTo(0, 3);
	});

	it('should reject a multi-channel output', () => {
		expect(() =>
			buildMask({ data: new Float32Array(8), dims: [1, 2, 2, 2] }, 2, 2, DEFAULT_MATTING_OPTIONS)
		).toThrow(AiToolError);
	});
});

describe('removeBackground', () => {
	it('should feed the model a tensor at the model input size', async () => {
		const session = maskSession(halfMask(), [1, 1, SPEC.output.height, SPEC.output.width]);
		await removeBackground(createImage(80, 40, [255, 255, 255, 255]), session, SPEC);

		const fed = session.feeds[0][SPEC.input.name];
		expect(fed.dims).toEqual([1, 3, SPEC.input.height, SPEC.input.width]);
	});

	it('should return an image the same size as the input frame', async () => {
		const session = maskSession(flatMask(1), [1, 1, SPEC.output.height, SPEC.output.width]);
		const result = await removeBackground(createImage(37, 21, [1, 2, 3, 255]), session, SPEC);
		expect(result.width).toBe(37);
		expect(result.height).toBe(21);
	});

	it('should cut out the half the model marked as background', async () => {
		const session = maskSession(halfMask(), [1, 1, SPEC.output.height, SPEC.output.width]);
		// Feathering off, so the two halves are unambiguous.
		const result = await removeBackground(
			createImage(64, 4, [200, 100, 50, 255]),
			session,
			SPEC,
			{ feather: 0 }
		);

		expect(result.data[3]).toBeGreaterThan(200);
		expect(result.data[63 * 4 + 3]).toBeLessThan(55);
	});

	it('should tolerate a session whose input is named differently', async () => {
		const session = maskSession(flatMask(1), [1, 1, SPEC.output.height, SPEC.output.width], {
			inputNames: ['x.1'],
		});
		await removeBackground(createImage(8, 8), session, SPEC);
		expect(Object.keys(session.feeds[0])).toEqual(['x.1']);
	});

	it('should tolerate a session whose sole output is named differently', async () => {
		const session = maskSession(flatMask(1), [1, 1, SPEC.output.height, SPEC.output.width], {
			outputName: 'renamed',
		});
		await expect(removeBackground(createImage(8, 8), session, SPEC)).resolves.toBeDefined();
	});

	it('should reject a model registered for another purpose', async () => {
		const upscaler = getModelSpec('realesrgan-x2plus')!;
		const session = maskSession(flatMask(1), [1, 1, SPEC.output.height, SPEC.output.width]);
		await expect(removeBackground(createImage(8, 8), session, upscaler)).rejects.toThrow(AiToolError);
	});

	it('should reject an empty frame instead of producing an empty buffer', async () => {
		const session = maskSession(flatMask(1), [1, 1, SPEC.output.height, SPEC.output.width]);
		await expect(removeBackground(createImage(0, 0), session, SPEC)).rejects.toThrow(AiToolError);
	});

	it('should propagate a session failure as a rejection, not an unhandled error', async () => {
		const session: AiSession = {
			inputNames: [SPEC.input.name],
			outputNames: [SPEC.output.name],
			run: vi.fn().mockRejectedValue(new Error('backend crashed')),
			release: async () => {},
		};
		await expect(removeBackground(createImage(8, 8), session, SPEC)).rejects.toThrow(
			'backend crashed'
		);
	});
});

describe('DEFAULT_MATTING_OPTIONS', () => {
	it('should default to a transparent background', () => {
		expect(DEFAULT_MATTING_OPTIONS.background).toBeNull();
	});
});

/** Guards the assumption that RgbaImage is what ImageData looks like. */
describe('RgbaImage', () => {
	it('should accept an ImageData-shaped object', () => {
		const imageData: RgbaImage = {
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1,
		};
		expect(compositeMask(imageData, new Float32Array([1])).width).toBe(1);
	});
});
