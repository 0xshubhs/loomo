import { describe, it, expect } from 'vitest';
import {
	cloneImage,
	createImage,
	cropImage,
	imageToNchw,
	nchwToImage,
	planTiles,
	readChwDims,
	resizeBilinear,
	resizePlaneBilinear,
	TileBlender,
	type RgbaImage,
} from './tensor.js';

const IDENTITY = { mean: [0, 0, 0] as const, std: [1, 1, 1] as const };

/** Builds an image from a flat list of [r,g,b,a] pixels in row-major order. */
function imageFrom(width: number, height: number, pixels: number[][]): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	pixels.forEach((pixel, index) => data.set(pixel, index * 4));
	return { data, width, height };
}

function constantImage(width: number, height: number, value: number): RgbaImage {
	return createImage(width, height, [value, value, value, 255]);
}

describe('createImage', () => {
	it('should default to opaque black', () => {
		const image = createImage(2, 2);
		expect([...image.data]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
	});

	it('should honour a fill colour', () => {
		const image = createImage(1, 1, [10, 20, 30, 40]);
		expect([...image.data]).toEqual([10, 20, 30, 40]);
	});
});

describe('cloneImage', () => {
	it('should copy rather than alias the buffer', () => {
		const original = createImage(1, 1, [1, 2, 3, 4]);
		const copy = cloneImage(original);
		copy.data[0] = 99;
		expect(original.data[0]).toBe(1);
	});
});

describe('resizeBilinear', () => {
	it('should return an equal copy when the size is unchanged', () => {
		const image = imageFrom(2, 1, [[10, 20, 30, 255], [40, 50, 60, 255]]);
		const result = resizeBilinear(image, 2, 1);
		expect([...result.data]).toEqual([...image.data]);
		expect(result.data).not.toBe(image.data);
	});

	it('should preserve a constant image at any size', () => {
		const result = resizeBilinear(constantImage(4, 4, 120), 9, 7);
		for (let i = 0; i < result.data.length; i += 4) expect(result.data[i]).toBe(120);
	});

	it('should keep the image centred rather than shifting it half a pixel', () => {
		// A symmetric gradient must stay symmetric; a half-pixel offset breaks it.
		const image = imageFrom(4, 1, [
			[0, 0, 0, 255],
			[90, 90, 90, 255],
			[90, 90, 90, 255],
			[0, 0, 0, 255],
		]);
		const result = resizeBilinear(image, 8, 1);
		for (let x = 0; x < 4; x++) {
			expect(result.data[x * 4]).toBe(result.data[(7 - x) * 4]);
		}
	});

	it('should produce the requested dimensions', () => {
		const result = resizeBilinear(constantImage(10, 6, 1), 320, 320);
		expect(result.width).toBe(320);
		expect(result.height).toBe(320);
		expect(result.data.length).toBe(320 * 320 * 4);
	});

	it('should reject a non-positive size', () => {
		expect(() => resizeBilinear(constantImage(2, 2, 0), 0, 4)).toThrow(RangeError);
	});
});

describe('resizePlaneBilinear', () => {
	it('should preserve a constant plane', () => {
		const plane = new Float32Array(9).fill(0.35);
		const result = resizePlaneBilinear(plane, 3, 3, 7, 5);
		for (const value of result) expect(value).toBeCloseTo(0.35, 6);
	});

	it('should interpolate between two values', () => {
		const plane = new Float32Array([0, 1]);
		const result = resizePlaneBilinear(plane, 2, 1, 4, 1);
		expect(result[0]).toBeLessThan(result[1]);
		expect(result[1]).toBeLessThan(result[2]);
		expect(result[2]).toBeLessThan(result[3]);
	});

	it('should reject a plane whose length does not match its dimensions', () => {
		expect(() => resizePlaneBilinear(new Float32Array(5), 3, 3, 3, 3)).toThrow(RangeError);
	});
});

describe('imageToNchw', () => {
	it('should group each channel into its own contiguous plane', () => {
		const image = imageFrom(2, 1, [
			[255, 0, 0, 255],
			[0, 255, 0, 255],
		]);
		const tensor = imageToNchw(image, IDENTITY);
		// Layout is [R0 R1][G0 G1][B0 B1], not [R0 G0 B0][R1 G1 B1].
		expect([...tensor.data]).toEqual([1, 0, 0, 1, 0, 0]);
	});

	it('should emit NCHW dimensions with a batch of 1', () => {
		const tensor = imageToNchw(constantImage(5, 3, 0), IDENTITY);
		expect(tensor.dims).toEqual([1, 3, 3, 5]);
	});

	it('should scale pixels into 0-1 under identity normalisation', () => {
		const tensor = imageToNchw(imageFrom(1, 1, [[0, 128, 255, 255]]), IDENTITY);
		expect(tensor.data[0]).toBe(0);
		expect(tensor.data[1]).toBeCloseTo(128 / 255, 6);
		expect(tensor.data[2]).toBe(1);
	});

	it('should apply per-channel mean and std', () => {
		const tensor = imageToNchw(imageFrom(1, 1, [[255, 255, 255, 255]]), {
			mean: [0.485, 0.456, 0.406],
			std: [0.229, 0.224, 0.225],
		});
		expect(tensor.data[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
		expect(tensor.data[1]).toBeCloseTo((1 - 0.456) / 0.224, 5);
		expect(tensor.data[2]).toBeCloseTo((1 - 0.406) / 0.225, 5);
	});

	it('should ignore the alpha channel', () => {
		const opaque = imageToNchw(imageFrom(1, 1, [[10, 20, 30, 255]]), IDENTITY);
		const transparent = imageToNchw(imageFrom(1, 1, [[10, 20, 30, 0]]), IDENTITY);
		expect([...opaque.data]).toEqual([...transparent.data]);
	});
});

describe('nchwToImage', () => {
	it('should round-trip through imageToNchw', () => {
		const image = imageFrom(2, 2, [
			[10, 20, 30, 255],
			[40, 50, 60, 255],
			[70, 80, 90, 255],
			[200, 210, 220, 255],
		]);
		const restored = nchwToImage(imageToNchw(image, IDENTITY), IDENTITY);
		expect([...restored.data]).toEqual([...image.data]);
	});

	it('should undo mean and std', () => {
		const normalisation = { mean: [0.5, 0.5, 0.5] as const, std: [0.25, 0.25, 0.25] as const };
		const image = imageFrom(1, 1, [[64, 128, 192, 255]]);
		const restored = nchwToImage(imageToNchw(image, normalisation), normalisation);
		expect([...restored.data.slice(0, 3)]).toEqual([64, 128, 192]);
	});

	it('should replicate a single channel into grey', () => {
		const restored = nchwToImage({ data: new Float32Array([0.5]), dims: [1, 1, 1, 1] }, IDENTITY);
		expect([...restored.data]).toEqual([128, 128, 128, 255]);
	});

	it('should clamp values outside 0-1 instead of wrapping', () => {
		const restored = nchwToImage(
			{ data: new Float32Array([-0.4, 1.9, 0.5]), dims: [3, 1, 1] },
			IDENTITY
		);
		expect([...restored.data.slice(0, 3)]).toEqual([0, 255, 128]);
	});

	it('should reject an unsupported channel count', () => {
		expect(() =>
			nchwToImage({ data: new Float32Array(2), dims: [1, 2, 1, 1] }, IDENTITY)
		).toThrow(RangeError);
	});
});

describe('readChwDims', () => {
	it('should read 4D dimensions', () => {
		expect(readChwDims([1, 3, 20, 10])).toEqual({ channels: 3, height: 20, width: 10 });
	});

	it('should read 3D dimensions', () => {
		expect(readChwDims([3, 20, 10])).toEqual({ channels: 3, height: 20, width: 10 });
	});

	it('should reject a batch larger than 1', () => {
		expect(() => readChwDims([2, 3, 4, 4])).toThrow(RangeError);
	});

	it('should reject an unexpected rank', () => {
		expect(() => readChwDims([3, 4])).toThrow(RangeError);
	});
});

describe('planTiles', () => {
	it('should return a single tile when the image fits', () => {
		expect(planTiles(200, 100, 256, 32)).toEqual([{ x: 0, y: 0, width: 200, height: 100 }]);
	});

	it('should keep every tile inside the image', () => {
		for (const tile of planTiles(1000, 700, 256, 32)) {
			expect(tile.x).toBeGreaterThanOrEqual(0);
			expect(tile.y).toBeGreaterThanOrEqual(0);
			expect(tile.x + tile.width).toBeLessThanOrEqual(1000);
			expect(tile.y + tile.height).toBeLessThanOrEqual(700);
		}
	});

	it('should cover every pixel of the image', () => {
		const width = 600;
		const height = 400;
		const covered = new Uint8Array(width * height);
		for (const tile of planTiles(width, height, 256, 32)) {
			for (let y = tile.y; y < tile.y + tile.height; y++) {
				for (let x = tile.x; x < tile.x + tile.width; x++) covered[y * width + x] = 1;
			}
		}
		expect(covered.every((flag) => flag === 1)).toBe(true);
	});

	it('should make neighbouring tiles overlap', () => {
		const tiles = planTiles(600, 256, 256, 32);
		const xs = [...new Set(tiles.map((tile) => tile.x))].sort((a, b) => a - b);
		expect(xs.length).toBeGreaterThan(1);
		for (let i = 1; i < xs.length; i++) {
			expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(256 - 32);
		}
	});

	it('should flush the final tile against the far edge', () => {
		const tiles = planTiles(700, 256, 256, 32);
		const maxRight = Math.max(...tiles.map((tile) => tile.x + tile.width));
		expect(maxRight).toBe(700);
	});

	it('should reject an overlap that is not smaller than the tile', () => {
		expect(() => planTiles(100, 100, 32, 32)).toThrow(RangeError);
		expect(() => planTiles(100, 100, 0, 0)).toThrow(RangeError);
		expect(() => planTiles(100, 100, 32, -1)).toThrow(RangeError);
	});
});

describe('cropImage', () => {
	it('should extract the requested rectangle', () => {
		const image = imageFrom(3, 2, [
			[1, 1, 1, 255],
			[2, 2, 2, 255],
			[3, 3, 3, 255],
			[4, 4, 4, 255],
			[5, 5, 5, 255],
			[6, 6, 6, 255],
		]);
		const crop = cropImage(image, { x: 1, y: 0, width: 2, height: 2 });
		expect(crop.width).toBe(2);
		expect([crop.data[0], crop.data[4], crop.data[8], crop.data[12]]).toEqual([2, 3, 5, 6]);
	});
});

describe('TileBlender', () => {
	it('should reproduce a constant image exactly across seams', () => {
		const width = 600;
		const height = 300;
		const tiles = planTiles(width, height, 256, 32);
		const blender = new TileBlender(width, height, 32);
		for (const tile of tiles) blender.add(constantImage(tile.width, tile.height, 137), tile.x, tile.y);

		const result = blender.finish();
		for (let i = 0; i < result.data.length; i += 4) expect(result.data[i]).toBe(137);
	});

	it('should not leave a visible seam between tiles of different brightness', () => {
		// Two tiles overlapping by 32px, one at 100 and one at 200. A hard join
		// would show a 100-level step; feathering must spread it out.
		const blender = new TileBlender(96, 8, 32);
		blender.add(constantImage(64, 8, 100), 0, 0);
		blender.add(constantImage(64, 8, 200), 32, 0);

		const blended = blender.finish();
		const row: number[] = [];
		for (let x = 0; x < 96; x++) row.push(blended.data[x * 4]);

		let biggestStep = 0;
		for (let x = 1; x < row.length; x++) {
			biggestStep = Math.max(biggestStep, Math.abs(row[x] - row[x - 1]));
		}
		expect(biggestStep).toBeLessThan(30);
	});

	it('should ramp monotonically from the first tile value to the second', () => {
		const blender = new TileBlender(96, 1, 32);
		blender.add(constantImage(64, 1, 0), 0, 0);
		blender.add(constantImage(64, 1, 255), 32, 0);
		const result = blender.finish();

		expect(result.data[0]).toBe(0);
		expect(result.data[95 * 4]).toBe(255);
		for (let x = 1; x < 96; x++) {
			expect(result.data[x * 4]).toBeGreaterThanOrEqual(result.data[(x - 1) * 4]);
		}
	});

	it('should reproduce tiles exactly when feathering is disabled', () => {
		const blender = new TileBlender(4, 1, 0);
		blender.add(constantImage(4, 1, 77), 0, 0);
		const result = blender.finish();
		for (let x = 0; x < 4; x++) expect(result.data[x * 4]).toBe(77);
	});

	it('should ignore tile pixels that fall outside the canvas', () => {
		const blender = new TileBlender(4, 4, 0);
		blender.add(constantImage(8, 8, 50), 2, 2);
		const result = blender.finish();
		// Top-left was never covered, so it stays at the uncovered sentinel.
		expect(result.data[0]).toBe(0);
		expect(result.data[3]).toBe(255);
		expect(result.data[(3 * 4 + 3) * 4]).toBe(50);
	});
});
