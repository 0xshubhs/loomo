import { describe, it, expect, vi } from 'vitest';
import {
	colorizeImage,
	combineLightnessChroma,
	DEFAULT_COLORIZE_OPTIONS,
	extractLightness,
	labToRgb,
	postprocessChroma,
	preprocessLightness,
	rgbToLab,
	toGrayscale,
	type ChromaPlanes,
} from './colorize.js';
import { getModelSpec } from './model-registry.js';
import { AiToolError, type AiSession, type AiTensor } from './runtime.js';
import { createImage, type RgbaImage } from './tensor.js';

const SPEC = getModelSpec('siggraph17-colorize')!;

/** Returns fixed chroma at the model's output resolution. */
function chromaSession(
	a: number,
	b: number
): AiSession & { feeds: Record<string, AiTensor>[] } {
	const feeds: Record<string, AiTensor>[] = [];
	const pixels = SPEC.output.width * SPEC.output.height;
	const data = new Float32Array(pixels * 2);
	data.fill(a, 0, pixels);
	data.fill(b, pixels, pixels * 2);

	return {
		feeds,
		inputNames: [SPEC.input.name],
		outputNames: [SPEC.output.name],
		async run(given) {
			feeds.push(given);
			return {
				[SPEC.output.name]: {
					type: 'float32',
					data,
					dims: [1, 2, SPEC.output.height, SPEC.output.width],
				},
			};
		},
		async release() {},
	};
}

function flatChroma(width: number, height: number, a: number, b: number): ChromaPlanes {
	return {
		a: new Float32Array(width * height).fill(a),
		b: new Float32Array(width * height).fill(b),
		width,
		height,
	};
}

describe('rgbToLab', () => {
	it('should map white to L=100 with no chroma', () => {
		const [l, a, b] = rgbToLab(255, 255, 255);
		expect(l).toBeCloseTo(100, 3);
		expect(a).toBeCloseTo(0, 3);
		expect(b).toBeCloseTo(0, 3);
	});

	it('should map black to L=0', () => {
		const [l, a, b] = rgbToLab(0, 0, 0);
		expect(l).toBeCloseTo(0, 6);
		expect(a).toBeCloseTo(0, 6);
		expect(b).toBeCloseTo(0, 6);
	});

	it('should give mid grey the standard L of about 53.6', () => {
		expect(rgbToLab(128, 128, 128)[0]).toBeCloseTo(53.585, 2);
	});

	it('should put pure red in the positive a, positive b quadrant', () => {
		const [l, a, b] = rgbToLab(255, 0, 0);
		expect(l).toBeCloseTo(53.24, 1);
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(0);
	});

	it('should give pure blue a strongly negative b', () => {
		expect(rgbToLab(0, 0, 255)[2]).toBeLessThan(-100);
	});

	it('should leave any neutral grey with zero chroma', () => {
		for (const value of [0, 32, 77, 128, 200, 255]) {
			const [, a, b] = rgbToLab(value, value, value);
			// Not exactly zero: the sRGB primaries do not sum to the D65 white
			// point in floating point, which leaves a few parts per million.
			expect(a).toBeCloseTo(0, 4);
			expect(b).toBeCloseTo(0, 4);
		}
	});
});

describe('labToRgb', () => {
	it('should round-trip a range of colours', () => {
		const colours: [number, number, number][] = [
			[0, 0, 0],
			[255, 255, 255],
			[128, 128, 128],
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
			[17, 200, 90],
			[240, 130, 20],
		];
		for (const [r, g, b] of colours) {
			const [l, la, lb] = rgbToLab(r, g, b);
			expect(labToRgb(l, la, lb)).toEqual([r, g, b]);
		}
	});

	it('should clamp out-of-gamut Lab back into 0-255', () => {
		for (const channel of labToRgb(50, 300, -300)) {
			expect(channel).toBeGreaterThanOrEqual(0);
			expect(channel).toBeLessThanOrEqual(255);
		}
	});

	it('should return a neutral grey for zero chroma', () => {
		const [r, g, b] = labToRgb(53.585, 0, 0);
		expect(r).toBe(g);
		expect(g).toBe(b);
	});
});

describe('toGrayscale', () => {
	it('should strip chroma from a colourful frame', () => {
		const image = createImage(1, 1, [200, 30, 90, 255]);
		const grey = toGrayscale(image);
		expect(grey.data[0]).toBe(grey.data[1]);
		expect(grey.data[1]).toBe(grey.data[2]);
	});

	it('should preserve lightness', () => {
		const original = rgbToLab(200, 30, 90)[0];
		const grey = toGrayscale(createImage(1, 1, [200, 30, 90, 255]));
		expect(rgbToLab(grey.data[0], grey.data[1], grey.data[2])[0]).toBeCloseTo(original, 0);
	});

	it('should preserve alpha', () => {
		expect(toGrayscale(createImage(1, 1, [10, 20, 30, 77])).data[3]).toBe(77);
	});

	it('should be idempotent on an already-grey frame', () => {
		const once = toGrayscale(createImage(2, 2, [120, 120, 120, 255]));
		const twice = toGrayscale(once);
		expect([...twice.data]).toEqual([...once.data]);
	});
});

describe('extractLightness', () => {
	it('should return one value per pixel', () => {
		expect(extractLightness(createImage(4, 3)).length).toBe(12);
	});

	it('should span 0 to 100 for black and white', () => {
		const image = createImage(2, 1, [0, 0, 0, 255]);
		image.data.set([255, 255, 255, 255], 4);
		const lightness = extractLightness(image);
		expect(lightness[0]).toBeCloseTo(0, 4);
		expect(lightness[1]).toBeCloseTo(100, 3);
	});
});

describe('preprocessLightness', () => {
	it('should emit a single-channel tensor at the model input size', () => {
		const tensor = preprocessLightness(createImage(80, 40), SPEC);
		expect(tensor.dims).toEqual([1, 1, SPEC.input.height, SPEC.input.width]);
		expect(tensor.data.length).toBe(SPEC.input.width * SPEC.input.height);
	});

	it('should centre lightness on zero by subtracting 50', () => {
		const white = preprocessLightness(createImage(4, 4, [255, 255, 255, 255]), SPEC);
		const black = preprocessLightness(createImage(4, 4, [0, 0, 0, 255]), SPEC);
		expect(white.data[0]).toBeCloseTo(50, 3);
		expect(black.data[0]).toBeCloseTo(-50, 3);
	});
});

describe('postprocessChroma', () => {
	it('should split the two planes and resize both', () => {
		const pixels = 4;
		const data = new Float32Array(pixels * 2);
		data.fill(10, 0, pixels);
		data.fill(-20, pixels, pixels * 2);

		const chroma = postprocessChroma({ data, dims: [1, 2, 2, 2] }, 6, 6);
		expect(chroma.a.length).toBe(36);
		expect(chroma.b.length).toBe(36);
		expect(chroma.a[0]).toBeCloseTo(10, 4);
		expect(chroma.b[0]).toBeCloseTo(-20, 4);
	});

	it('should reject an output that is not two channels', () => {
		expect(() => postprocessChroma({ data: new Float32Array(4), dims: [1, 1, 2, 2] }, 2, 2)).toThrow(
			AiToolError
		);
	});
});

describe('combineLightnessChroma', () => {
	it('should leave the frame untouched at zero strength', () => {
		const image = createImage(2, 2, [120, 120, 120, 255]);
		const result = combineLightnessChroma(image, flatChroma(2, 2, 40, -30), 0);
		for (let i = 0; i < result.data.length; i += 4) {
			expect(result.data[i]).toBeCloseTo(120, -1);
			expect(result.data[i]).toBe(result.data[i + 1]);
		}
	});

	it('should add colour at full strength', () => {
		const result = combineLightnessChroma(
			createImage(1, 1, [120, 120, 120, 255]),
			flatChroma(1, 1, 40, 20),
			1
		);
		expect(result.data[0]).toBeGreaterThan(result.data[2]);
	});

	it('should scale the effect with strength', () => {
		const grey = createImage(1, 1, [120, 120, 120, 255]);
		const half = combineLightnessChroma(grey, flatChroma(1, 1, 40, 20), 0.5);
		const full = combineLightnessChroma(grey, flatChroma(1, 1, 40, 20), 1);
		expect(half.data[0]).toBeGreaterThan(120);
		expect(half.data[0]).toBeLessThan(full.data[0]);
	});

	it('should keep the frame lightness rather than the model resolution', () => {
		const image = createImage(1, 1, [200, 200, 200, 255]);
		const result = combineLightnessChroma(image, flatChroma(1, 1, 0, 0), 1);
		expect([...result.data.slice(0, 3)]).toEqual([200, 200, 200]);
	});

	it('should preserve alpha', () => {
		const result = combineLightnessChroma(
			createImage(1, 1, [10, 10, 10, 42]),
			flatChroma(1, 1, 5, 5),
			1
		);
		expect(result.data[3]).toBe(42);
	});

	it('should clamp strength outside 0-1', () => {
		const grey = createImage(1, 1, [120, 120, 120, 255]);
		const over = combineLightnessChroma(grey, flatChroma(1, 1, 40, 20), 5);
		const one = combineLightnessChroma(grey, flatChroma(1, 1, 40, 20), 1);
		expect([...over.data]).toEqual([...one.data]);
	});

	it('should reject chroma planes that do not match the frame', () => {
		expect(() => combineLightnessChroma(createImage(2, 2), flatChroma(1, 1, 0, 0), 1)).toThrow(
			RangeError
		);
	});
});

describe('colorizeImage', () => {
	it('should feed a single-channel tensor at the model input size', async () => {
		const session = chromaSession(0, 0);
		await colorizeImage(createImage(90, 60, [100, 100, 100, 255]), session, SPEC);
		expect(session.feeds[0][SPEC.input.name].dims).toEqual([
			1,
			1,
			SPEC.input.height,
			SPEC.input.width,
		]);
	});

	it('should return an image the size of the input frame', async () => {
		const result = await colorizeImage(createImage(33, 17), chromaSession(0, 0), SPEC);
		expect(result.width).toBe(33);
		expect(result.height).toBe(17);
	});

	it('should tint a grey frame towards the predicted chroma', async () => {
		const result = await colorizeImage(
			createImage(8, 8, [120, 120, 120, 255]),
			chromaSession(50, 30),
			SPEC
		);
		expect(result.data[0]).toBeGreaterThan(result.data[2]);
	});

	it('should return a grey frame unchanged when the model predicts no chroma', async () => {
		const image = createImage(8, 8, [120, 120, 120, 255]);
		const result = await colorizeImage(image, chromaSession(0, 0), SPEC);
		for (let i = 0; i < result.data.length; i += 4) {
			expect(result.data[i]).toBe(result.data[i + 1]);
			expect(result.data[i + 1]).toBe(result.data[i + 2]);
		}
	});

	it('should discard existing colour before predicting new colour', async () => {
		// A sepia scan and its grey equivalent must colourise identically.
		const grey = createImage(4, 4, [128, 128, 128, 255]);
		const sepia = toGrayscale(createImage(4, 4, [150, 120, 90, 255]));
		const fromGrey = await colorizeImage(grey, chromaSession(0, 0), SPEC);
		const fromSepia = await colorizeImage(sepia, chromaSession(0, 0), SPEC);
		expect(fromSepia.data[0]).toBe(fromSepia.data[2]);
		expect(fromGrey.data[0]).toBe(fromGrey.data[2]);
	});

	it('should respect a zero strength', async () => {
		const image = createImage(4, 4, [120, 120, 120, 255]);
		const result = await colorizeImage(image, chromaSession(60, 60), SPEC, { strength: 0 });
		expect(result.data[0]).toBe(result.data[2]);
	});

	it('should reject a model registered for another purpose', async () => {
		await expect(
			colorizeImage(createImage(8, 8), chromaSession(0, 0), getModelSpec('u2netp')!)
		).rejects.toThrow(AiToolError);
	});

	it('should reject an empty frame', async () => {
		await expect(colorizeImage(createImage(0, 0), chromaSession(0, 0), SPEC)).rejects.toThrow(
			AiToolError
		);
	});

	it('should stop when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			colorizeImage(createImage(8, 8), chromaSession(0, 0), SPEC, { signal: controller.signal })
		).rejects.toThrow(/cancelled/i);
	});

	it('should propagate a session failure as a rejection', async () => {
		const session: AiSession = {
			inputNames: [SPEC.input.name],
			outputNames: [SPEC.output.name],
			run: vi.fn().mockRejectedValue(new Error('kernel missing')),
			release: async () => {},
		};
		await expect(colorizeImage(createImage(8, 8), session, SPEC)).rejects.toThrow('kernel missing');
	});
});

describe('DEFAULT_COLORIZE_OPTIONS', () => {
	it('should use full strength by default', () => {
		expect(DEFAULT_COLORIZE_OPTIONS.strength).toBe(1);
	});
});

/** Documents that ImageData can be handed straight to these functions. */
describe('RgbaImage compatibility', () => {
	it('should accept an ImageData-shaped object', () => {
		const frame: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
		expect(extractLightness(frame).length).toBe(1);
	});
});
