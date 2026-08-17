import { describe, it, expect } from 'vitest';
import {
	writeInChunks,
	streamFileInChunks,
	detach,

	type ChunkSink,
} from './chunked-write.js';

/**
 * Chunked writes fix an OOM that killed the desktop app on video import.
 *
 * The danger in chunking is silent corruption: if the first chunk appends
 * rather than truncates, re-importing doubles the file; if a later chunk
 * truncates, everything before it vanishes. Either way ffmpeg reports only a
 * vague decode error, so the ordering is asserted directly here.
 */

/**
 * Stands in for the Rust side, reconstructing what would land on disk.
 *
 * Chunks are kept as typed arrays and joined once at the end. An earlier
 * version accumulated via `Array.from(chunk).concat(...)`, which turned every
 * 8MB chunk into eight million boxed JS numbers and killed the test worker —
 * the same mistake, in miniature, that this module exists to fix.
 */
function recorder() {
	const calls: { size: number; append: boolean; detached: boolean }[] = [];
	let pieces: Uint8Array[] = [];
	let truncations = 0;

	const sink: ChunkSink = async (chunk, append) => {
		calls.push({
			size: chunk.byteLength,
			append,
			detached: chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength,
		});
		if (append) {
			pieces.push(chunk);
		} else {
			truncations++;
			pieces = [chunk];
		}
	};

	return {
		sink,
		calls,
		get bytes(): Uint8Array {
			const total = pieces.reduce((sum, p) => sum + p.byteLength, 0);
			const out = new Uint8Array(total);
			let offset = 0;
			for (const piece of pieces) {
				out.set(piece, offset);
				offset += piece.byteLength;
			}
			return out;
		},
		get truncations() {
			return truncations;
		},
	};
}

/**
 * Chunk size used for most tests.
 *
 * The splitting logic does not care how big a chunk is, so exercising it with
 * a few hundred bytes proves the same properties as eight megabytes without
 * allocating hundreds of MB per test.
 */
const SMALL = 256;

// Explicitly backed by ArrayBuffer: the bare `Uint8Array` alias widens to
// ArrayBufferLike, which the File constructor will not accept.
function pattern(size: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) bytes[i] = (i * 7 + 13) % 251;
	return bytes;
}

describe('detach', () => {
	it('passes through a buffer-backed array untouched', () => {
		const whole = new Uint8Array(10);
		expect(detach(whole)).toBe(whole);
	});

	it('copies a view so the IPC cannot see the parent buffer', () => {
		// A subarray shares its parent's ArrayBuffer, and the IPC layer
		// serialises the buffer, not the view — so a 500MB file would be sent
		// in full with every chunk.
		const parent = new Uint8Array(1000);
		const view = parent.subarray(100, 200);
		const result = detach(view);

		expect(result).not.toBe(view);
		expect(result.byteOffset).toBe(0);
		expect(result.buffer.byteLength).toBe(100);
	});
});

describe('writeInChunks', () => {
	it('writes a small buffer in one truncating call', async () => {
		const rec = recorder();
		await writeInChunks(new Uint8Array([1, 2, 3]), rec.sink);

		expect(rec.calls).toHaveLength(1);
		expect(rec.calls[0].append).toBe(false);
		expect(Array.from(rec.bytes)).toEqual([1, 2, 3]);
	});

	it('splits a large buffer and reassembles it byte for byte', async () => {
		const source = pattern(SMALL * 2 + 77);
		const rec = recorder();
		await writeInChunks(source, rec.sink, SMALL);

		expect(rec.calls).toHaveLength(3);
		expect(rec.truncations).toBe(1);
		expect(rec.bytes).toEqual(source);
	});

	it('truncates on the first chunk and appends thereafter', async () => {
		const rec = recorder();
		await writeInChunks(pattern(SMALL * 3), rec.sink, SMALL);

		expect(rec.calls[0].append).toBe(false);
		expect(rec.calls.slice(1).every((c) => c.append)).toBe(true);
	});

	it('never exceeds the chunk size', async () => {
		const rec = recorder();
		await writeInChunks(pattern(SMALL * 2 + 7), rec.sink, SMALL);
		expect(rec.calls.every((c) => c.size <= SMALL)).toBe(true);
	});

	it('detaches every chunk it sends', async () => {
		const rec = recorder();
		await writeInChunks(pattern(SMALL * 2), rec.sink, SMALL);
		expect(rec.calls.every((c) => c.detached)).toBe(true);
	});

	it('handles a buffer exactly one chunk long', async () => {
		const source = pattern(SMALL);
		const rec = recorder();
		await writeInChunks(source, rec.sink, SMALL);

		expect(rec.calls).toHaveLength(1);
		expect(rec.bytes).toEqual(source);
	});

	it('handles an empty buffer', async () => {
		const rec = recorder();
		await writeInChunks(new Uint8Array(0), rec.sink);
		expect(rec.calls).toHaveLength(1);
		expect(rec.bytes).toHaveLength(0);
	});

	it('reassembles correctly at an awkward chunk size', async () => {
		const source = pattern(1000);
		const rec = recorder();
		await writeInChunks(source, rec.sink, 7);

		expect(rec.calls).toHaveLength(Math.ceil(1000 / 7));
		expect(rec.bytes).toEqual(source);
	});
});

describe('streamFileInChunks', () => {
	it('streams a File and reassembles it exactly', async () => {
		const source = pattern(SMALL * 3 + 11);
		const rec = recorder();
		await streamFileInChunks(new File([source], 'clip.mp4'), rec.sink, undefined, SMALL);

		expect(rec.truncations).toBe(1);
		expect(rec.bytes).toEqual(source);
	});

	it('reports monotonic progress ending at 1', async () => {
		const seen: number[] = [];
		const rec = recorder();
		await streamFileInChunks(
			new File([pattern(1000)], 'clip.mp4'),
			rec.sink,
			(f) => seen.push(f),
			100
		);

		expect(seen).toHaveLength(10);
		expect(seen.at(-1)).toBeCloseTo(1, 6);
		for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
	});

	it('creates a real file even when the source is empty', async () => {
		// ffmpeg should fail on an empty input on its own terms, rather than
		// the write silently doing nothing and leaving a stale file behind.
		const rec = recorder();
		await streamFileInChunks(new File([], 'empty.mp4'), rec.sink);

		expect(rec.calls).toHaveLength(1);
		expect(rec.calls[0].append).toBe(false);
		expect(rec.bytes).toHaveLength(0);
	});

	it('only ever holds one chunk at a time', async () => {
		// Peak memory is what this whole change is about: no call may carry
		// more than the chunk size regardless of how big the file is.
		const rec = recorder();
		await streamFileInChunks(new File([pattern(5000)], 'clip.mp4'), rec.sink, undefined, 512);
		expect(Math.max(...rec.calls.map((c) => c.size))).toBeLessThanOrEqual(512);
	});
});
