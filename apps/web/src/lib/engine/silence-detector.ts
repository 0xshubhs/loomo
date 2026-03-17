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
