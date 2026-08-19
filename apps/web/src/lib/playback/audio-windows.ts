/**
 * Preview audio in bounded windows.
 *
 * Extracting a whole clip to PCM does not scale: a 50-minute source produced a
 * 536 MB WAV, which was then read back through the IPC in one piece and
 * expanded by `decodeAudioData` into a 1.07 GB Float32 buffer. Peak was around
 * 2.5 GB for a single clip, the cache held three, and the app was OOM-killed
 * with the status line still reading "Extracting audio".
 *
 * A window is a fixed slice of the source. Only the window under the playhead
 * and the one after it need to exist, so memory is a constant few megabytes
 * however long the clip is.
 *
 * All arithmetic, no I/O, so the chaining rules are pinned down by tests
 * rather than discovered during playback.
 */

/** Seconds per window. 30s of 44.1kHz stereo float is about 10 MB. */
export const WINDOW_SECONDS = 30;

/**
 * How far ahead of a window's end to start fetching the next one.
 *
 * Extraction seeks accurately, which means decoding and discarding everything
 * before the window — about 0.5ms per second of source, so 1.6s at fifty
 * minutes in and around 6s for a three-hour file. Ten seconds covers that with
 * room to spare; asking at the boundary would leave audible silence there.
 */
export const PREFETCH_LEAD_SECONDS = 10;

/** Which window a point in the source falls in. */
export function windowIndexFor(sourceSeconds: number, windowSeconds = WINDOW_SECONDS): number {
	if (windowSeconds <= 0) return 0;
	return Math.max(0, Math.floor(Math.max(0, sourceSeconds) / windowSeconds));
}

/** Where a window starts in the source. */
export function windowStart(index: number, windowSeconds = WINDOW_SECONDS): number {
	return Math.max(0, index) * windowSeconds;
}

/** Offset into a window's buffer for a point in the source. */
export function offsetInWindow(
	sourceSeconds: number,
	index: number,
	windowSeconds = WINDOW_SECONDS
): number {
	return Math.max(0, Math.max(0, sourceSeconds) - windowStart(index, windowSeconds));
}

/**
 * The window to fetch ahead of time, or null when there is no point.
 *
 * Returns null until the playhead is within the lead, and null once the source
 * has no more audio to read.
 */
export function windowToPrefetch(
	sourceSeconds: number,
	sourceDuration: number,
	windowSeconds = WINDOW_SECONDS,
	leadSeconds = PREFETCH_LEAD_SECONDS
): number | null {
	const index = windowIndexFor(sourceSeconds, windowSeconds);
	const endOfWindow = windowStart(index, windowSeconds) + windowSeconds;

	if (endOfWindow >= sourceDuration) return null;
	if (sourceSeconds < endOfWindow - leadSeconds) return null;

	return index + 1;
}

/** A cache key for one window of one asset. */
export function windowKey(assetId: string, index: number): string {
	return `${assetId}:w${index}`;
}

/**
 * Windows worth keeping, given where the playhead is.
 *
 * The current one and the next, and nothing else: a window behind the playhead
 * will not be played again without a seek, and a seek re-extracts in a few
 * hundred milliseconds. Holding more is how this ran out of memory.
 */
export function windowsToKeep(sourceSeconds: number, windowSeconds = WINDOW_SECONDS): number[] {
	const index = windowIndexFor(sourceSeconds, windowSeconds);
	return [index, index + 1];
}
