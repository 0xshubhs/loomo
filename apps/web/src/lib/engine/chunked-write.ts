/**
 * Splitting large writes into bounded chunks.
 *
 * Handing a whole video to the IPC in one payload costs a copy in the page, a
 * copy in transit, and a copy on the far side. On an ordinary clip that was
 * enough to push the desktop app past 5GB and get it OOM-killed during import.
 *
 * Kept as plain functions rather than methods on the engine so the logic is
 * testable without the Svelte compiler, and so the ordering guarantee below is
 * pinned down by tests: the first chunk truncates, every later chunk appends.
 * Getting that backwards corrupts the file in a way ffmpeg reports only as a
 * vague decode error.
 */

/**
 * Bytes per write.
 *
 * Small enough that a chunk and its copies are negligible, large enough that a
 * 1GB file is ~128 round trips rather than tens of thousands.
 */
export const WRITE_CHUNK_BYTES = 8 * 1024 * 1024;

/** Performs one write; `append` is false only for the first chunk of a file. */
export type ChunkSink = (chunk: Uint8Array, append: boolean) => Promise<void>;

/**
 * Detaches a view from its parent buffer when necessary.
 *
 * `subarray` shares the underlying ArrayBuffer, and the IPC layer serialises
 * the whole buffer rather than the view — so passing one straight through
 * would ship the entire original file with every single chunk, which is the
 * exact blow-up this module exists to avoid.
 */
export function detach(chunk: Uint8Array): Uint8Array {
	const isWholeBuffer = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength;
	return isWholeBuffer ? chunk : new Uint8Array(chunk);
}

/** Writes an in-memory buffer, splitting it if it exceeds the chunk size. */
export async function writeInChunks(
	bytes: Uint8Array,
	sink: ChunkSink,
	chunkSize = WRITE_CHUNK_BYTES
): Promise<void> {
	if (bytes.byteLength <= chunkSize) {
		await sink(detach(bytes), false);
		return;
	}

	for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
		const chunk = bytes.subarray(offset, offset + chunkSize);
		await sink(detach(chunk), offset > 0);
	}
}

/**
 * Streams a `File` without ever materialising it whole.
 *
 * Only one slice is resident at a time, so peak memory is the chunk size
 * rather than the file size.
 */
export async function streamFileInChunks(
	file: File,
	sink: ChunkSink,
	onProgress?: (fraction: number) => void,
	chunkSize = WRITE_CHUNK_BYTES
): Promise<void> {
	let offset = 0;
	let first = true;

	while (offset < file.size) {
		const slice = file.slice(offset, offset + chunkSize);
		const bytes = new Uint8Array(await slice.arrayBuffer());
		await sink(bytes, !first);
		first = false;
		offset += bytes.byteLength;
		onProgress?.(file.size > 0 ? offset / file.size : 1);
	}

	// An empty file must still be created, so ffmpeg fails on its own terms
	// rather than the write silently doing nothing.
	if (first) {
		await sink(new Uint8Array(0), false);
		onProgress?.(1);
	}
}
