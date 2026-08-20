export interface SilenceOptions {
	threshold: number;   // 0-1, default 0.01
	minDuration: number; // seconds, default 0.5
}

export interface SilenceRegion {
	startTime: number;
	endTime: number;
	duration: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
	threshold: 0.01,
	minDuration: 0.5,
};

/**
 * Analyze an AudioBuffer and return regions where RMS amplitude
 * falls below the given threshold for at least minDuration seconds.
 */
export function detectSilences(
	audioBuffer: AudioBuffer,
	options: SilenceOptions = DEFAULT_SILENCE_OPTIONS
): SilenceRegion[] {
	const { threshold, minDuration } = options;
	const sampleRate = audioBuffer.sampleRate;
	const channelData = audioBuffer.getChannelData(0);
	const totalSamples = channelData.length;

	// Analyze in small windows (~10ms each)
	const windowSize = Math.floor(sampleRate * 0.01);
	const regions: SilenceRegion[] = [];

	let silenceStart: number | null = null;

	for (let i = 0; i < totalSamples; i += windowSize) {
		const end = Math.min(i + windowSize, totalSamples);
		let sumSquares = 0;
		const count = end - i;

		for (let j = i; j < end; j++) {
			sumSquares += channelData[j] * channelData[j];
		}

		const rms = Math.sqrt(sumSquares / count);
		const timePos = i / sampleRate;

		if (rms < threshold) {
			if (silenceStart === null) {
				silenceStart = timePos;
			}
		} else {
			if (silenceStart !== null) {
				const silenceDuration = timePos - silenceStart;
				if (silenceDuration >= minDuration) {
					regions.push({
						startTime: silenceStart,
						endTime: timePos,
						duration: silenceDuration,
					});
				}
				silenceStart = null;
			}
		}
	}

	// Handle trailing silence
	if (silenceStart !== null) {
		const endTime = totalSamples / sampleRate;
		const silenceDuration = endTime - silenceStart;
		if (silenceDuration >= minDuration) {
			regions.push({
				startTime: silenceStart,
				endTime: endTime,
				duration: silenceDuration,
			});
		}
	}

	return regions;
}

/**
 * Finding silence with ffmpeg instead of in the page.
 *
 * The Web Audio route below decodes the whole file to an AudioBuffer, which is
 * ~40MB per minute of stereo — a 50-minute source is over a gigabyte before
 * the scan starts, and it took the app down. `silencedetect` streams: ffmpeg
 * reads the file once, prints the regions to stderr, and nothing but text
 * crosses back. Length stops mattering.
 */

/** The analysis pass. Writes nothing; the answer is in what it logs. */
export function silenceDetectArgs(
	path: string,
	options: SilenceOptions = DEFAULT_SILENCE_OPTIONS
): string[] {
	return [
		'-i', path,
		'-af', `silencedetect=noise=${thresholdToDb(options.threshold)}dB:d=${options.minDuration}`,
		// No output file: `-f null -` runs the graph and discards the frames.
		'-f', 'null', '-',
	];
}

/**
 * `silencedetect` takes a level in dB; the UI slider is linear 0–1.
 *
 * A threshold of zero is "perfect digital silence", which is -infinity dB and
 * not something to hand a filter, so it is floored at -100dB — quiet enough to
 * mean the same thing.
 */
export function thresholdToDb(threshold: number): number {
	if (threshold <= 0) return -100;
	return Math.max(-100, Math.round(20 * Math.log10(Math.min(threshold, 1)) * 10) / 10);
}

/**
 * Reads the regions back out of ffmpeg's log.
 *
 * The lines come in pairs:
 *
 *   [silencedetect @ 0x…] silence_start: 12.345
 *   [silencedetect @ 0x…] silence_end: 15.678 | silence_duration: 3.333
 *
 * A file that ends while still silent gets a start with no end, so the caller
 * passes the duration to close the last region with.
 */
export function parseSilenceOutput(lines: string[], sourceDuration = 0): SilenceRegion[] {
	const regions: SilenceRegion[] = [];
	let start: number | null = null;

	for (const line of lines) {
		const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
		if (startMatch) {
			// A negative start is ffmpeg counting from before the first frame.
			start = Math.max(0, parseFloat(startMatch[1]));
			continue;
		}

		const endMatch = line.match(/silence_end:\s*([\d.]+)/);
		if (endMatch && start !== null) {
			const end = parseFloat(endMatch[1]);
			if (end > start) regions.push({ startTime: start, endTime: end, duration: end - start });
			start = null;
		}
	}

	// Trailing silence: the file ended before the filter saw sound again.
	if (start !== null && sourceDuration > start) {
		regions.push({ startTime: start, endTime: sourceDuration, duration: sourceDuration - start });
	}

	return regions;
}

/**
 * Decode audio from a Blob using the Web Audio API.
 */
export async function analyzeAudioFromBlob(blob: Blob): Promise<AudioBuffer> {
	const arrayBuffer = await blob.arrayBuffer();
	const audioContext = new AudioContext();
	try {
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
		return audioBuffer;
	} finally {
		await audioContext.close();
	}
}
