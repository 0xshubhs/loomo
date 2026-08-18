/**
 * Pixel ↔ tensor plumbing shared by every AI tool.
 *
 * Kept DOM-free on purpose: `RgbaImage` is structurally what `ImageData` is, so
 * callers can pass a canvas's ImageData straight in, while the tests (and any
 * future worker) run with nothing but typed arrays.
 */

/** `ImageData` satisfies this, so no conversion is needed at the call site. */
export interface RgbaImage {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

/** A plain float tensor. Matches `AiTensor` without importing the runtime. */
export interface FloatTensor {
	data: Float32Array;
	dims: readonly number[];
}

export function createImage(width: number, height: number, fill?: [number, number, number, number]): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	if (fill) {
		for (let i = 0; i < data.length; i += 4) {
			data[i] = fill[0];
			data[i + 1] = fill[1];
			data[i + 2] = fill[2];
			data[i + 3] = fill[3];
		}
	} else {
		// An all-zero buffer is transparent black; opaque is the useful default.
		for (let i = 3; i < data.length; i += 4) data[i] = 255;
	}
	return { data, width, height };
}

export function cloneImage(image: RgbaImage): RgbaImage {
	return {
		data: new Uint8ClampedArray(image.data),
		width: image.width,
		height: image.height,
	};
}

/**
 * Bilinear resample.
 *
 * Used both to squeeze a frame down to the model's fixed input size and to
 * stretch its output back up, so accuracy here shows up directly as mask
 * quality. Sampling uses pixel centres — the naive `x * scale` mapping shifts
 * the image by half a pixel per axis, which is visible as a drifting cutout.
 */
export function resizeBilinear(image: RgbaImage, width: number, height: number): RgbaImage {
	if (width <= 0 || height <= 0) throw new RangeError('resizeBilinear needs a positive size');
	if (width === image.width && height === image.height) return cloneImage(image);

	const out = new Uint8ClampedArray(width * height * 4);
	const scaleX = image.width / width;
	const scaleY = image.height / height;
	const maxX = image.width - 1;
	const maxY = image.height - 1;

	for (let y = 0; y < height; y++) {
		const sy = Math.min(maxY, Math.max(0, (y + 0.5) * scaleY - 0.5));
		const y0 = Math.floor(sy);
		const y1 = Math.min(maxY, y0 + 1);
		const fy = sy - y0;

		for (let x = 0; x < width; x++) {
			const sx = Math.min(maxX, Math.max(0, (x + 0.5) * scaleX - 0.5));
			const x0 = Math.floor(sx);
			const x1 = Math.min(maxX, x0 + 1);
			const fx = sx - x0;

			const i00 = (y0 * image.width + x0) * 4;
			const i01 = (y0 * image.width + x1) * 4;
			const i10 = (y1 * image.width + x0) * 4;
			const i11 = (y1 * image.width + x1) * 4;
			const target = (y * width + x) * 4;

			for (let c = 0; c < 4; c++) {
				const top = image.data[i00 + c] * (1 - fx) + image.data[i01 + c] * fx;
				const bottom = image.data[i10 + c] * (1 - fx) + image.data[i11 + c] * fx;
				out[target + c] = Math.round(top * (1 - fy) + bottom * fy);
			}
		}
	}

	return { data: out, width, height };
}

/** Same bilinear filter, for single-channel float planes such as masks. */
export function resizePlaneBilinear(
	plane: Float32Array,
	srcWidth: number,
	srcHeight: number,
	dstWidth: number,
	dstHeight: number
): Float32Array {
	if (plane.length !== srcWidth * srcHeight) {
		throw new RangeError(`Plane is ${plane.length} values, expected ${srcWidth * srcHeight}`);
	}
	if (srcWidth === dstWidth && srcHeight === dstHeight) return new Float32Array(plane);

	const out = new Float32Array(dstWidth * dstHeight);
	const scaleX = srcWidth / dstWidth;
	const scaleY = srcHeight / dstHeight;
	const maxX = srcWidth - 1;
	const maxY = srcHeight - 1;

	for (let y = 0; y < dstHeight; y++) {
		const sy = Math.min(maxY, Math.max(0, (y + 0.5) * scaleY - 0.5));
		const y0 = Math.floor(sy);
		const y1 = Math.min(maxY, y0 + 1);
		const fy = sy - y0;

		for (let x = 0; x < dstWidth; x++) {
			const sx = Math.min(maxX, Math.max(0, (x + 0.5) * scaleX - 0.5));
			const x0 = Math.floor(sx);
			const x1 = Math.min(maxX, x0 + 1);
			const fx = sx - x0;

			const top = plane[y0 * srcWidth + x0] * (1 - fx) + plane[y0 * srcWidth + x1] * fx;
			const bottom = plane[y1 * srcWidth + x0] * (1 - fx) + plane[y1 * srcWidth + x1] * fx;
			out[y * dstWidth + x] = top * (1 - fy) + bottom * fy;
		}
	}

	return out;
}

export interface Normalisation {
	readonly mean: readonly [number, number, number];
	readonly std: readonly [number, number, number];
}

/**
 * Packs RGB into a `1 × 3 × H × W` float tensor.
 *
 * NCHW means all of red comes first, then all of green, then all of blue —
 * *not* interleaved like the source buffer. Getting this wrong produces an
 * output that looks like plausible noise rather than an obvious error, which
 * is why it is tested directly.
 */
export function imageToNchw(image: RgbaImage, normalisation: Normalisation): FloatTensor {
	const { width, height } = image;
	const pixels = width * height;
	const data = new Float32Array(pixels * 3);
	const { mean, std } = normalisation;

	for (let p = 0; p < pixels; p++) {
		const source = p * 4;
		for (let c = 0; c < 3; c++) {
			data[c * pixels + p] = (image.data[source + c] / 255 - mean[c]) / std[c];
		}
	}

	return { data, dims: [1, 3, height, width] };
}

/**
 * Unpacks a `[1,]C × H × W` float tensor back into RGBA, undoing `normalisation`.
 * C of 1 is replicated to grey; C of 3 maps to RGB. Alpha is always opaque —
 * tools that produce transparency set it themselves afterwards.
 */
export function nchwToImage(tensor: FloatTensor, normalisation: Normalisation): RgbaImage {
	const { channels, height, width } = readChwDims(tensor.dims);
	if (channels !== 1 && channels !== 3) {
		throw new RangeError(`Expected 1 or 3 channels, got ${channels}`);
	}

	const pixels = width * height;
	const out = new Uint8ClampedArray(pixels * 4);
	const { mean, std } = normalisation;

	for (let p = 0; p < pixels; p++) {
		const target = p * 4;
		for (let c = 0; c < 3; c++) {
			const plane = channels === 1 ? 0 : c;
			const stat = channels === 1 ? 0 : c;
			const value = tensor.data[plane * pixels + p] * std[stat] + mean[stat];
			out[target + c] = Math.round(value * 255);
		}
		out[target + 3] = 255;
	}

	return { data: out, width, height };
}

/** Reads C/H/W out of `[N,C,H,W]` or `[C,H,W]`, rejecting batches above one. */
export function readChwDims(dims: readonly number[]): {
	channels: number;
	height: number;
	width: number;
} {
	if (dims.length === 4) {
		if (dims[0] !== 1) throw new RangeError(`Only batch size 1 is supported, got ${dims[0]}`);
		return { channels: dims[1], height: dims[2], width: dims[3] };
	}
	if (dims.length === 3) {
		return { channels: dims[0], height: dims[1], width: dims[2] };
	}
	throw new RangeError(`Expected a 3D or 4D tensor, got [${dims.join(', ')}]`);
}

export interface Tile {
	/** Source-space rectangle, overlap skirt included. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Splits an image into overlapping tiles.
 *
 * Upscalers run at a fixed input size and their memory cost grows with the
 * square of it, so a 4K frame has to be cut up. Tiles overlap because a model
 * hallucinating detail near a tile edge has no context on the other side, and
 * butt-joined tiles leave a visible grid.
 *
 * The last tile in each axis is flush with the far edge rather than hanging
 * off it, so no tile is ever partly outside the image.
 */
export function planTiles(
	width: number,
	height: number,
	tileSize: number,
	overlap: number
): Tile[] {
	if (tileSize <= 0) throw new RangeError('tileSize must be positive');
	if (overlap < 0) throw new RangeError('overlap cannot be negative');
	if (overlap >= tileSize) throw new RangeError('overlap must be smaller than tileSize');

	const starts = (length: number): number[] => {
		if (length <= tileSize) return [0];
		const step = tileSize - overlap;
		const out: number[] = [];
		for (let s = 0; s < length - tileSize; s += step) out.push(s);
		out.push(length - tileSize);
		return out;
	};

	const tiles: Tile[] = [];
	for (const y of starts(height)) {
		for (const x of starts(width)) {
			tiles.push({
				x,
				y,
				width: Math.min(tileSize, width),
				height: Math.min(tileSize, height),
			});
		}
	}
	return tiles;
}

export function cropImage(image: RgbaImage, tile: Tile): RgbaImage {
	const out = new Uint8ClampedArray(tile.width * tile.height * 4);
	for (let y = 0; y < tile.height; y++) {
		const sourceY = Math.min(image.height - 1, tile.y + y);
		const sourceRow = (sourceY * image.width + tile.x) * 4;
		const targetRow = y * tile.width * 4;
		// Clamp the copy width so a tile reaching past the edge still produces a
		// full-size buffer rather than throwing.
		const copyable = Math.min(tile.width, image.width - tile.x);
		out.set(image.data.subarray(sourceRow, sourceRow + copyable * 4), targetRow);
	}
	return { data: out, width: tile.width, height: tile.height };
}

/**
 * Reassembles tiles into one image with the seams blended away.
 *
 * Each tile contributes with a weight that ramps up from its edge inward over
 * `feather` pixels, and the accumulated weights are divided out at the end.
 * Normalising this way is what makes the result exact rather than merely close:
 * where two tiles agree, any pair of weights that sums to the same total gives
 * back the original value.
 *
 * The minimum weight is deliberately non-zero so a pixel covered by exactly one
 * tile — every pixel along the image border — still normalises to itself
 * instead of dividing by zero.
 */
export class TileBlender {
	private readonly accumulator: Float32Array;
	private readonly weights: Float32Array;

	constructor(
		readonly width: number,
		readonly height: number,
		private readonly feather: number
	) {
		this.accumulator = new Float32Array(width * height * 4);
		this.weights = new Float32Array(width * height);
	}

	add(tile: RgbaImage, offsetX: number, offsetY: number): void {
		const ramp = Math.max(0, Math.floor(this.feather));

		for (let y = 0; y < tile.height; y++) {
			const destY = offsetY + y;
			if (destY < 0 || destY >= this.height) continue;
			const weightY = edgeWeight(y, tile.height, ramp);

			for (let x = 0; x < tile.width; x++) {
				const destX = offsetX + x;
				if (destX < 0 || destX >= this.width) continue;

				const weight = weightY * edgeWeight(x, tile.width, ramp);
				const source = (y * tile.width + x) * 4;
				const target = (destY * this.width + destX) * 4;

				this.accumulator[target] += tile.data[source] * weight;
				this.accumulator[target + 1] += tile.data[source + 1] * weight;
				this.accumulator[target + 2] += tile.data[source + 2] * weight;
				this.accumulator[target + 3] += tile.data[source + 3] * weight;
				this.weights[destY * this.width + destX] += weight;
			}
		}
	}

	finish(): RgbaImage {
		const out = new Uint8ClampedArray(this.width * this.height * 4);
		for (let p = 0; p < this.weights.length; p++) {
			const weight = this.weights[p];
			const target = p * 4;
			if (weight === 0) {
				// Only reachable if a caller left a gap in its tiling; opaque black
				// is a visible failure rather than an invisible one.
				out[target + 3] = 255;
				continue;
			}
			for (let c = 0; c < 4; c++) {
				out[target + c] = Math.round(this.accumulator[target + c] / weight);
			}
		}
		return { data: out, width: this.width, height: this.height };
	}
}

/** 1 in the tile's interior, ramping down towards its edges over `ramp` px. */
function edgeWeight(index: number, length: number, ramp: number): number {
	if (ramp === 0) return 1;
	const distance = Math.min(index, length - 1 - index);
	return Math.min(1, (distance + 1) / (ramp + 1));
}
