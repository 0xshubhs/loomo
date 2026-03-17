import type { Track, Clip } from '$lib/types/index.js';

export class AudioMixer {
	private audioContext: AudioContext | null = null;
	private gainNodes = new Map<string, GainNode>();
	private sourceNodes = new Map<string, MediaElementAudioSourceNode>();
	private highpassNodes = new Map<string, BiquadFilterNode>();
	private lowpassNodes = new Map<string, BiquadFilterNode>();
	private noiseSuppressionEnabled = new Map<string, boolean>();

	initialize(): void {
		if (this.audioContext) return;
		this.audioContext = new AudioContext();
	}

	connectVideoElement(trackId: string, video: HTMLVideoElement, volume: number = 1): void {
		if (!this.audioContext) return;
		if (this.sourceNodes.has(trackId)) return;

		try {
			const source = this.audioContext.createMediaElementSource(video);
			const gain = this.audioContext.createGain();
			gain.gain.value = volume;

			// Create noise suppression filters (initially bypassed)
			const highpass = this.audioContext.createBiquadFilter();
			highpass.type = 'highpass';
			highpass.frequency.value = 200;

			const lowpass = this.audioContext.createBiquadFilter();
			lowpass.type = 'lowpass';
			lowpass.frequency.value = 8000;

			// Default chain: source → gain → destination (no filters)
			source.connect(gain);
			gain.connect(this.audioContext.destination);

			this.sourceNodes.set(trackId, source);
			this.gainNodes.set(trackId, gain);
			this.highpassNodes.set(trackId, highpass);
			this.lowpassNodes.set(trackId, lowpass);
			this.noiseSuppressionEnabled.set(trackId, false);
		} catch {
			// Element may already be connected
		}
	}

	private rewireChain(trackId: string, enableNoiseSuppression: boolean): void {
		if (!this.audioContext) return;
		const source = this.sourceNodes.get(trackId);
		const gain = this.gainNodes.get(trackId);
		const highpass = this.highpassNodes.get(trackId);
		const lowpass = this.lowpassNodes.get(trackId);
		if (!source || !gain || !highpass || !lowpass) return;

		const wasEnabled = this.noiseSuppressionEnabled.get(trackId) ?? false;
		if (wasEnabled === enableNoiseSuppression) return;

		// Disconnect current chain
		source.disconnect();
		gain.disconnect();
		highpass.disconnect();
		lowpass.disconnect();

		if (enableNoiseSuppression) {
			// source → highpass → lowpass → gain → destination
			source.connect(highpass);
			highpass.connect(lowpass);
			lowpass.connect(gain);
			gain.connect(this.audioContext.destination);
		} else {
			// source → gain → destination
			source.connect(gain);
			gain.connect(this.audioContext.destination);
		}

		this.noiseSuppressionEnabled.set(trackId, enableNoiseSuppression);
	}

	setVolume(trackId: string, volume: number): void {
		const gain = this.gainNodes.get(trackId);
		if (gain) {
			gain.gain.setValueAtTime(volume, this.audioContext?.currentTime ?? 0);
		}
	}

	mute(trackId: string): void {
		this.setVolume(trackId, 0);
	}

	unmute(trackId: string, volume: number = 1): void {
		this.setVolume(trackId, volume);
	}

	/**
	 * Compute gain multiplier for fade in/out at a given time within a clip.
	 */
	private computeFadeGain(clip: Clip, currentTime: number): number {
		const clipStart = clip.timelineStart;
		const clipEnd = clipStart + clip.duration;
		const fadeIn = clip.fadeIn ?? 0;
		const fadeOut = clip.fadeOut ?? 0;
		let fadeGain = 1;

		// Fade in: ramp from 0 to 1 over fadeIn seconds from clip start
		if (fadeIn > 0 && currentTime < clipStart + fadeIn) {
			fadeGain = Math.max(0, (currentTime - clipStart) / fadeIn);
		}

		// Fade out: ramp from 1 to 0 over fadeOut seconds before clip end
		if (fadeOut > 0 && currentTime > clipEnd - fadeOut) {
			fadeGain = Math.min(fadeGain, Math.max(0, (clipEnd - currentTime) / fadeOut));
		}

		return fadeGain;
	}

	updateMix(tracks: Track[], currentTime: number): void {
		for (const track of tracks) {
			const gain = this.gainNodes.get(track.id);
			if (!gain) continue;

			if (track.muted) {
				gain.gain.value = 0;
				continue;
			}

			const activeClip = track.clips.find(
				(c) => currentTime >= c.timelineStart && currentTime < c.timelineStart + c.duration
			);

			if (activeClip) {
				const clipVolume = activeClip.muted ? 0 : activeClip.volume;
				const fadeGain = this.computeFadeGain(activeClip, currentTime);
				gain.gain.value = track.volume * clipVolume * fadeGain;

				// Rewire noise suppression chain if needed
				this.rewireChain(track.id, activeClip.noiseSuppression ?? false);
			} else {
				gain.gain.value = 0;
			}
		}
	}

	destroy(): void {
		for (const source of this.sourceNodes.values()) {
			source.disconnect();
		}
		for (const gain of this.gainNodes.values()) {
			gain.disconnect();
		}
		for (const hp of this.highpassNodes.values()) {
			hp.disconnect();
		}
		for (const lp of this.lowpassNodes.values()) {
			lp.disconnect();
		}
		this.sourceNodes.clear();
		this.gainNodes.clear();
		this.highpassNodes.clear();
		this.lowpassNodes.clear();
		this.noiseSuppressionEnabled.clear();
		this.audioContext?.close();
		this.audioContext = null;
	}
}
