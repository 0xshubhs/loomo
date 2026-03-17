import type { CaptionSegment } from '$lib/types/index.js';
import { generateId } from '$lib/utils/id.js';

/**
 * Check whether the Web Speech API is available in the current browser.
 */
export function isSpeechRecognitionSupported(): boolean {
	return !!(
		(window as any).SpeechRecognition ||
		(window as any).webkitSpeechRecognition
	);
}

/**
 * Transcribe audio using the Web Speech API.
 *
 * Flow:
 *  1. A hidden <audio> element plays the provided audio blob
 *  2. SpeechRecognition listens to the system audio simultaneously
 *  3. onresult events are captured with timestamps
 *  4. Results are grouped into segments of roughly 5-10 words
 *
 * Requires a user gesture to have occurred before calling.
 */
export function transcribeAudio(
	audioBlob: Blob,
	language: string = 'en-US',
	onProgress?: (status: string) => void,
	abortSignal?: AbortSignal
): Promise<CaptionSegment[]> {
	return new Promise((resolve, reject) => {
		if (!isSpeechRecognitionSupported()) {
			reject(new Error('Web Speech API is not supported in this browser. Please use Chrome or Edge.'));
			return;
		}

		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

		const recognition = new SpeechRecognition();
		recognition.continuous = true;
		recognition.interimResults = false;
		recognition.lang = language;
		recognition.maxAlternatives = 1;

		const audioUrl = URL.createObjectURL(audioBlob);
		const audio = document.createElement('audio');
		audio.src = audioUrl;
		audio.volume = 0.01; // Near-silent but audible enough for recognition
		audio.preload = 'auto';

		const segments: CaptionSegment[] = [];
		let wordBuffer: { word: string; time: number }[] = [];
		let segmentStartTime = 0;
		let audioStartTimestamp = 0;
		let finished = false;

		function cleanup() {
			finished = true;
			try { recognition.stop(); } catch {}
			audio.pause();
			audio.removeAttribute('src');
			URL.revokeObjectURL(audioUrl);
		}

		function flushBuffer() {
			if (wordBuffer.length === 0) return;

			const text = wordBuffer.map((w) => w.word).join(' ').trim();
			if (!text) {
				wordBuffer = [];
				return;
			}

			const startTime = wordBuffer[0].time;
			const endTime = wordBuffer[wordBuffer.length - 1].time + 0.5; // Add small buffer

			segments.push({
				id: generateId(),
				text,
				startTime: Math.max(0, startTime),
				endTime: Math.min(audio.duration || endTime, endTime),
			});

			wordBuffer = [];
		}

		// Handle abort
		if (abortSignal) {
			abortSignal.addEventListener('abort', () => {
				cleanup();
				reject(new Error('Transcription cancelled'));
			});
		}

		recognition.onresult = (event: any) => {
			const now = (Date.now() - audioStartTimestamp) / 1000;

			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i];
				if (!result.isFinal) continue;

				const transcript = result[0].transcript.trim();
				if (!transcript) continue;

				const words = transcript.split(/\s+/);
				const wordDuration = words.length > 0 ? 0.3 : 0; // Approximate per-word duration
				const chunkStartTime = Math.max(0, now - words.length * wordDuration);

				for (let w = 0; w < words.length; w++) {
					const wordTime = chunkStartTime + w * wordDuration;
					wordBuffer.push({ word: words[w], time: wordTime });
				}

				// Flush when buffer has enough words or after a pause
				if (wordBuffer.length >= 8) {
					flushBuffer();
					segmentStartTime = now;
				}
			}

			onProgress?.(`Transcribing... (${segments.length} segments)`);
		};

		recognition.onerror = (event: any) => {
			// 'no-speech' is common and not fatal
			if (event.error === 'no-speech' || event.error === 'aborted') return;
			console.warn('[Caption] Speech recognition error:', event.error);
		};

		recognition.onend = () => {
			if (finished) return;

			// If audio is still playing, restart recognition
			if (!audio.paused && !audio.ended) {
				try {
					recognition.start();
				} catch {
					// Recognition may fail to restart; finish with what we have
					flushBuffer();
					cleanup();
					resolve(segments);
				}
				return;
			}

			flushBuffer();
			cleanup();
			resolve(segments);
		};

		audio.onended = () => {
			onProgress?.('Finishing transcription...');
			// Give recognition a moment to process remaining audio
			setTimeout(() => {
				flushBuffer();
				cleanup();
				resolve(segments);
			}, 1500);
		};

		audio.onerror = () => {
			cleanup();
			reject(new Error('Failed to play audio for transcription'));
		};

		audio.oncanplaythrough = () => {
			onProgress?.('Listening...');
			audioStartTimestamp = Date.now();

			try {
				recognition.start();
			} catch (err) {
				cleanup();
				reject(new Error(`Failed to start speech recognition: ${err}`));
				return;
			}

			audio.play().catch((err) => {
				cleanup();
				reject(new Error(`Failed to play audio: ${err}`));
			});
		};
	});
}

/**
 * Supported languages for the speech recognition API.
 */
export const SUPPORTED_LANGUAGES = [
	{ value: 'en-US', label: 'English (US)' },
	{ value: 'es-ES', label: 'Spanish' },
	{ value: 'fr-FR', label: 'French' },
	{ value: 'de-DE', label: 'German' },
	{ value: 'ja-JP', label: 'Japanese' },
	{ value: 'hi-IN', label: 'Hindi' },
	{ value: 'pt-BR', label: 'Portuguese (BR)' },
	{ value: 'zh-CN', label: 'Chinese (Simplified)' },
	{ value: 'ko-KR', label: 'Korean' },
	{ value: 'ar-SA', label: 'Arabic' },
	{ value: 'it-IT', label: 'Italian' },
	{ value: 'nl-NL', label: 'Dutch' },
] as const;
