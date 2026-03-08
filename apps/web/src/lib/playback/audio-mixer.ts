import type { Track, Clip } from '$lib/types/index.js';

export class AudioMixer {
	private audioContext: AudioContext | null = null;
	private gainNodes = new Map<string, GainNode>();
	private sourceNodes = new Map<string, MediaElementAudioSourceNode>();

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

			source.connect(gain);
			gain.connect(this.audioContext.destination);

			this.sourceNodes.set(trackId, source);
			this.gainNodes.set(trackId, gain);
		} catch {
			// Element may already be connected
		}
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
				gain.gain.value = track.volume * (activeClip.muted ? 0 : activeClip.volume);
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
		this.sourceNodes.clear();
		this.gainNodes.clear();
		this.audioContext?.close();
		this.audioContext = null;
	}
}
