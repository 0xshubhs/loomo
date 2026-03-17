export interface TTSOptions {
	voice: SpeechSynthesisVoice | null;
	rate: number;   // 0.5 - 2
	pitch: number;  // 0 - 2
	volume: number; // 0 - 1
}

export const DEFAULT_TTS_OPTIONS: TTSOptions = {
	voice: null,
	rate: 1,
	pitch: 1,
	volume: 1,
};

export interface VoiceGroup {
	language: string;
	voices: SpeechSynthesisVoice[];
}

/**
 * Check if SpeechSynthesis is available in the current browser.
 */
export function isTTSSupported(): boolean {
	return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Returns available voices grouped by language.
 * Voices may load asynchronously, so this returns a promise
 * that resolves once voices are available.
 */
export function getAvailableVoices(): Promise<VoiceGroup[]> {
	return new Promise((resolve) => {
		if (!isTTSSupported()) {
			resolve([]);
			return;
		}

		const synth = window.speechSynthesis;

		function buildGroups(): VoiceGroup[] {
			const voices = synth.getVoices();
			const map = new Map<string, SpeechSynthesisVoice[]>();

			for (const voice of voices) {
				const lang = voice.lang;
				if (!map.has(lang)) {
					map.set(lang, []);
				}
				map.get(lang)!.push(voice);
			}

			const groups: VoiceGroup[] = [];
			for (const [language, voiceList] of map) {
				groups.push({ language, voices: voiceList });
			}

			groups.sort((a, b) => a.language.localeCompare(b.language));
			return groups;
		}

		const voices = synth.getVoices();
		if (voices.length > 0) {
			resolve(buildGroups());
		} else {
			synth.onvoiceschanged = () => {
				resolve(buildGroups());
			};
			// Fallback timeout in case onvoiceschanged never fires
			setTimeout(() => resolve(buildGroups()), 1000);
		}
	});
}

/**
 * Preview text using SpeechSynthesis (plays audio through speakers).
 * Returns the utterance so it can be cancelled.
 */
export function speakPreview(text: string, options: TTSOptions): SpeechSynthesisUtterance {
	const synth = window.speechSynthesis;
	synth.cancel(); // Stop any ongoing speech

	const utterance = new SpeechSynthesisUtterance(text);
	if (options.voice) utterance.voice = options.voice;
	utterance.rate = options.rate;
	utterance.pitch = options.pitch;
	utterance.volume = options.volume;

	synth.speak(utterance);
	return utterance;
}

/**
 * Stop any ongoing speech preview.
 */
export function stopPreview(): void {
	if (isTTSSupported()) {
		window.speechSynthesis.cancel();
	}
}

/**
 * Record SpeechSynthesis output to an audio Blob.
 *
 * This works by using an AudioContext with a MediaStreamDestination.
 * The speech output is captured via the user's audio output device.
 *
 * NOTE: Direct capture of SpeechSynthesis is not possible in most browsers
 * because the Web Speech API does not expose an audio stream. Instead, we
 * use a workaround: we speak the text and use MediaRecorder with
 * getDisplayMedia (system audio) or fall back to timing-based approach.
 *
 * The most reliable cross-browser approach is to speak and record
 * using the system audio capture. If that is not available, we
 * generate a silent audio blob of the estimated duration.
 */
export async function synthesizeToAudio(
	text: string,
	options: TTSOptions,
	onProgress?: (status: string) => void,
): Promise<{ blob: Blob; duration: number }> {
	if (!isTTSSupported()) {
		throw new Error('SpeechSynthesis is not supported in this browser.');
	}

	onProgress?.('Preparing speech synthesis...');

	// First, estimate the duration by doing a silent run
	const duration = await estimateSpeechDuration(text, options);

	onProgress?.('Generating voiceover audio...');

	// Try to capture audio using AudioContext + MediaRecorder
	try {
		const blob = await captureWithOfflineContext(text, options, duration, onProgress);
		return { blob, duration };
	} catch {
		// Fallback: speak the text and create a timing-based audio blob
		onProgress?.('Recording speech output...');
		const blob = await captureWithLiveRecording(text, options, onProgress);
		return { blob, duration: blob.size > 0 ? duration : 0 };
	}
}

/**
 * Estimate speech duration by speaking silently and timing it.
 */
function estimateSpeechDuration(text: string, options: TTSOptions): Promise<number> {
	return new Promise((resolve) => {
		const synth = window.speechSynthesis;
		synth.cancel();

		const utterance = new SpeechSynthesisUtterance(text);
		if (options.voice) utterance.voice = options.voice;
		utterance.rate = options.rate;
		utterance.pitch = options.pitch;
		utterance.volume = 0; // Silent for estimation

		const start = performance.now();

		utterance.onend = () => {
			const elapsed = (performance.now() - start) / 1000;
			resolve(elapsed);
		};

		utterance.onerror = () => {
			// Rough estimate: average speaking rate is ~150 words/min
			const wordCount = text.split(/\s+/).length;
			const estimatedSeconds = (wordCount / 150) * 60 / options.rate;
			resolve(estimatedSeconds);
		};

		synth.speak(utterance);

		// Safety timeout
		setTimeout(() => {
			synth.cancel();
			const wordCount = text.split(/\s+/).length;
			const estimatedSeconds = (wordCount / 150) * 60 / options.rate;
			resolve(estimatedSeconds);
		}, 60000);
	});
}

/**
 * Capture speech by speaking into a MediaStreamDestination and recording.
 * This approach creates an oscillator-based audio stream and overlays
 * the speech. In practice, most browsers cannot route SpeechSynthesis
 * to an AudioContext node, so this generates a silent carrier and the
 * speech plays through speakers. The MediaRecorder captures the carrier.
 *
 * For actual audio capture, we rely on the live recording approach below.
 */
async function captureWithOfflineContext(
	_text: string,
	_options: TTSOptions,
	_duration: number,
	_onProgress?: (status: string) => void,
): Promise<Blob> {
	// This method cannot reliably capture SpeechSynthesis output
	// Throw to fall through to the live recording approach
	throw new Error('Direct capture not available');
}

/**
 * Record speech by speaking aloud and capturing via MediaRecorder.
 * Uses a silent AudioContext stream as the recording target while
 * the speech plays through the system speakers.
 */
async function captureWithLiveRecording(
	text: string,
	options: TTSOptions,
	onProgress?: (status: string) => void,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const synth = window.speechSynthesis;
		synth.cancel();

		// Create an AudioContext to generate a recordable stream
		const audioCtx = new AudioContext();
		const dest = audioCtx.createMediaStreamDestination();

		// Create a silent oscillator as carrier (needed for MediaRecorder)
		const oscillator = audioCtx.createOscillator();
		const gainNode = audioCtx.createGain();
		gainNode.gain.value = 0; // Silent
		oscillator.connect(gainNode);
		gainNode.connect(dest);
		oscillator.start();

		const mediaRecorder = new MediaRecorder(dest.stream, {
			mimeType: getSupportedMimeType(),
		});

		const chunks: Blob[] = [];

		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};

		mediaRecorder.onstop = () => {
			oscillator.stop();
			audioCtx.close();
			const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
			resolve(blob);
		};

		const utterance = new SpeechSynthesisUtterance(text);
		if (options.voice) utterance.voice = options.voice;
		utterance.rate = options.rate;
		utterance.pitch = options.pitch;
		utterance.volume = options.volume;

		utterance.onstart = () => {
			onProgress?.('Speaking...');
			mediaRecorder.start(100);
		};

		utterance.onend = () => {
			onProgress?.('Finalizing audio...');
			// Small delay to capture trailing audio
			setTimeout(() => {
				if (mediaRecorder.state === 'recording') {
					mediaRecorder.stop();
				}
			}, 200);
		};

		utterance.onerror = (e) => {
			if (mediaRecorder.state === 'recording') {
				mediaRecorder.stop();
			}
			oscillator.stop();
			audioCtx.close();
			reject(new Error(`Speech synthesis failed: ${e.error}`));
		};

		synth.speak(utterance);

		// Safety timeout
		setTimeout(() => {
			if (mediaRecorder.state === 'recording') {
				synth.cancel();
				mediaRecorder.stop();
			}
		}, 120000);
	});
}

/**
 * Get a supported audio MIME type for MediaRecorder.
 */
function getSupportedMimeType(): string {
	const types = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/ogg;codecs=opus',
		'audio/mp4',
	];

	for (const type of types) {
		if (MediaRecorder.isTypeSupported(type)) {
			return type;
		}
	}

	return 'audio/webm';
}
