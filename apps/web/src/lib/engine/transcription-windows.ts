import type { CaptionSegment } from '$lib/types/index.js';

/**
 * Transcribing a long recording in bounded windows.
 *
 * Captions used to hand the whole file to the recogniser: `assetBlob` read the
 * scratch copy in one piece, which costs a copy in Rust, one in transit and one
 * in the page. A 978 MB MKV is about three gigabytes before anything has
 * decoded, so `asset-bytes` now refuses anything over 400 MB and captions
 * simply stopped being available on real recordings — the user's files are
 * 50-minute, ~900 MB sources.
 *
 * The fix is the one preview audio already uses: extract a window at a time and
 * throw it away afterwards. The arithmetic lives here, apart from the I/O, so
 * the rules that decide where a window starts and how two windows are joined
 * are pinned down by tests rather than discovered halfway through a 50-minute
 * transcription.
 */

/**
 * Seconds of source per window.
 *
 * Five minutes of 16 kHz mono PCM is about 9.6 MB — the size that matters,
 * since that is what crosses the IPC and becomes a Blob. Longer windows are
 * cheaper overall (fewer seams to stitch, fewer accurate seeks) and the
 * recogniser plays the audio back in real time either way, so the window length
 * has almost no effect on how long a transcription takes.
 */
export const TRANSCRIBE_WINDOW_SECONDS = 300;

/**
 * How much of the previous window each window repeats.
 *
 * Without an overlap a word straddling the boundary is lost twice over: the
 * first window hears its opening syllable and the second hears its tail, and
 * the recogniser discards both as noise. Three seconds is longer than any
 * ordinary spoken word plus the endpointing delay the recogniser needs before
 * it will emit a final result, so anything cut in half by one window is heard
 * whole by the next. The repeat is then removed by `stitchWindow`.
 */
export const TRANSCRIBE_OVERLAP_SECONDS = 3;

/**
 * Slack allowed when deciding whether a segment sits at the seam.
 *
 * The Web Speech API reports no timings of its own, so `transcribeAudio`
 * estimates them from wall-clock arrival and a flat 0.3s per word. That
 * estimate drifts by a second or so over a phrase, and a seam repeat matched
 * only on exact times would be missed whenever it did.
 */
export const SEAM_TIME_SLACK_SECONDS = 2;

/**
 * Words compared on each side of a seam.
 *
 * The repeat can only be as long as the overlap — a few words — so scanning
 * further is just a wider net for coincidental matches.
 */
const SEAM_SCAN_WORDS = 40;

/**
 * Shortest repeat treated as a seam repeat rather than a coincidence.
 *
 * One shared word at a boundary is usually "the" or "and" turning up twice by
 * chance, and dropping it would eat a real word. Two in a row in the same order
 * at the same moment is the same speech heard twice. The cost of the rule is
 * that a lone word spoken inside the overlap can be transcribed twice, which is
 * a visible duplicate rather than a silent deletion — the better failure.
 */
const MIN_SEAM_MATCH_WORDS = 2;

export interface TranscriptionWindow {
	index: number;
	/** Where the window starts in the source, in seconds. */
	start: number;
	/** How much source the window covers, in seconds. */
	duration: number;
}

/**
 * The windows covering a source of the given length.
 *
 * Consecutive windows advance by less than their length, so each one repeats
 * the last few seconds of the one before it; see `TRANSCRIBE_OVERLAP_SECONDS`.
 * A trailing window that would contain nothing but that repeat is not emitted —
 * it costs an accurate seek and a recogniser session to produce material that
 * is already transcribed.
 */
export function transcriptionWindows(
	sourceDuration: number,
	windowSeconds = TRANSCRIBE_WINDOW_SECONDS,
	overlapSeconds = TRANSCRIBE_OVERLAP_SECONDS
): TranscriptionWindow[] {
	if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return [];

	const span = Math.max(1, windowSeconds);
	// An overlap of half a window or more would never advance far enough to
	// finish a long file.
	const overlap = Math.max(0, Math.min(overlapSeconds, span / 2));
	const stride = span - overlap;

	const windows: TranscriptionWindow[] = [];
	let start = 0;

	while (start < sourceDuration) {
		windows.push({
			index: windows.length,
			start,
			duration: Math.min(span, sourceDuration - start),
		});

		start += stride;
		if (start + overlap >= sourceDuration) break;
	}

	return windows;
}

/** The same segments, moved from window time into source time. */
export function shiftSegments(segments: CaptionSegment[], offsetSeconds: number): CaptionSegment[] {
	return segments.map((segment) => ({
		...segment,
		startTime: segment.startTime + offsetSeconds,
		endTime: segment.endTime + offsetSeconds,
	}));
}

/**
 * Adds one window's segments to the transcript so far.
 *
 * The window's own timings start from zero, so they are moved into source time
 * first; without that every window's captions would land on top of the opening
 * minutes of the file.
 *
 * The join drops the speech the overlap deliberately heard twice. Matching is
 * done word by word rather than segment by segment because the recogniser
 * groups roughly eight words at a time and does not group the same way twice: a
 * seam commonly reads "…jumps over the lazy" then "over the lazy dog and…",
 * where no whole segment repeats but four words do. The earlier copy is kept,
 * so a word only ever survives from the window that heard it first.
 */
export function stitchWindow(
	accumulated: CaptionSegment[],
	windowSegments: CaptionSegment[],
	windowStart: number,
	overlapSeconds = TRANSCRIBE_OVERLAP_SECONDS
): CaptionSegment[] {
	const shifted = shiftSegments(windowSegments, windowStart);
	if (accumulated.length === 0) return shifted;
	if (shifted.length === 0) return [...accumulated];

	const seamStart = windowStart - SEAM_TIME_SLACK_SECONDS;
	const seamEnd = windowStart + Math.max(0, overlapSeconds) + SEAM_TIME_SLACK_SECONDS;

	const tail = wordsOf(accumulated.filter((segment) => segment.endTime >= seamStart)).slice(
		-SEAM_SCAN_WORDS
	);
	const head = wordsOf(shifted.filter((segment) => segment.startTime <= seamEnd)).slice(
		0,
		SEAM_SCAN_WORDS
	);

	const repeated = longestSeamRepeat(tail, head);
	return [...accumulated, ...dropLeadingWords(shifted, repeated)];
}

/** Every word of these segments, in order, compared case- and punctuation-blind. */
function wordsOf(segments: CaptionSegment[]): string[] {
	return segments.flatMap((segment) => splitWords(segment.text)).map(normalizeWord);
}

function splitWords(text: string): string[] {
	return text.split(/\s+/).filter((word) => word.length > 0);
}

function normalizeWord(word: string): string {
	// "Lazy," and "lazy" are the same word heard twice; the recogniser
	// punctuates a phrase differently depending on what follows it.
	return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

/**
 * How many words at the start of the new window repeat the end of the old one.
 *
 * The longest match wins: a short match inside a longer one would leave the
 * rest of the repeat in place.
 */
function longestSeamRepeat(tail: string[], head: string[]): number {
	const longest = Math.min(tail.length, head.length);

	for (let length = longest; length >= MIN_SEAM_MATCH_WORDS; length--) {
		let same = true;
		for (let i = 0; i < length; i++) {
			if (tail[tail.length - length + i] !== head[i]) {
				same = false;
				break;
			}
		}
		if (same) return length;
	}

	return 0;
}

/**
 * Removes the first `count` words, dropping segments emptied by it.
 *
 * A partly trimmed segment has its start moved forward by the share of its own
 * span the removed words occupied. That is an estimate, but so is every timing
 * this recogniser produces, and leaving the start where it was would show the
 * caption seconds before the words it still contains are spoken.
 */
function dropLeadingWords(segments: CaptionSegment[], count: number): CaptionSegment[] {
	if (count <= 0) return segments;

	const kept: CaptionSegment[] = [];
	let remaining = count;

	for (const segment of segments) {
		if (remaining <= 0) {
			kept.push(segment);
			continue;
		}

		const words = splitWords(segment.text);
		if (remaining >= words.length) {
			remaining -= words.length;
			continue;
		}

		const span = Math.max(0, segment.endTime - segment.startTime);
		kept.push({
			...segment,
			text: words.slice(remaining).join(' '),
			startTime: segment.startTime + (span * remaining) / words.length,
		});
		remaining = 0;
	}

	return kept;
}
