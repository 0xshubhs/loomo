import type { Command } from './base-command.js';
import type { Clip } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import { generateId } from '$lib/utils/id.js';

export class SetVolumeCommand implements Command {
	readonly type = 'set-volume';
	readonly description: string;
	private previousVolume: number = 1;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newVolume: number
	) {
		this.description = `Set volume to ${Math.round(newVolume * 100)}%`;
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousVolume = clip.volume;
		clip.volume = this.newVolume;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;
		clip.volume = this.previousVolume;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class MuteTrackCommand implements Command {
	readonly type = 'mute-track';
	readonly description: string;
	private previousMuted: boolean = false;

	constructor(
		private timeline: TimelineStore,
		private trackId: string,
		private muted: boolean
	) {
		this.description = muted ? 'Mute track' : 'Unmute track';
	}

	execute(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) throw new Error(`Track ${this.trackId} not found`);
		this.previousMuted = track.muted;
		track.muted = this.muted;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;
		track.muted = this.previousMuted;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetTrackVolumeCommand implements Command {
	readonly type = 'set-track-volume';
	readonly description: string;
	private previousVolume: number = 1;

	constructor(
		private timeline: TimelineStore,
		private trackId: string,
		private newVolume: number
	) {
		this.description = `Set track volume to ${Math.round(newVolume * 100)}%`;
	}

	execute(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) throw new Error(`Track ${this.trackId} not found`);
		this.previousVolume = track.volume;
		track.volume = this.newVolume;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;
		track.volume = this.previousVolume;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetClipFadeInCommand implements Command {
	readonly type = 'set-clip-fade-in';
	readonly description: string;
	private previousFadeIn: number = 0;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newFadeIn: number
	) {
		this.description = `Set fade in to ${newFadeIn.toFixed(1)}s`;
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousFadeIn = clip.fadeIn;
		clip.fadeIn = this.newFadeIn;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;
		clip.fadeIn = this.previousFadeIn;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetClipFadeOutCommand implements Command {
	readonly type = 'set-clip-fade-out';
	readonly description: string;
	private previousFadeOut: number = 0;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newFadeOut: number
	) {
		this.description = `Set fade out to ${newFadeOut.toFixed(1)}s`;
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousFadeOut = clip.fadeOut;
		clip.fadeOut = this.newFadeOut;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;
		clip.fadeOut = this.previousFadeOut;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetNoiseSuppressionCommand implements Command {
	readonly type = 'set-noise-suppression';
	readonly description: string;
	private previousValue: boolean = false;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private enabled: boolean
	) {
		this.description = enabled ? 'Enable noise suppression' : 'Disable noise suppression';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousValue = clip.noiseSuppression;
		clip.noiseSuppression = this.enabled;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;
		clip.noiseSuppression = this.previousValue;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class DetachAudioCommand implements Command {
	readonly type = 'detach-audio';
	readonly description = 'Detach audio from video';
	private audioClip: Clip | null = null;
	private audioTrackId: string | null = null;
	private createdTrack: boolean = false;
	private previousMuted: boolean = false;

	constructor(
		private timeline: TimelineStore,
		private clipId: string
	) {}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		if (clip.type !== 'video') throw new Error('Can only detach audio from video clips');

		this.previousMuted = clip.muted;

		// Find or create an audio track
		let audioTrack = this.timeline.tracks.find((t) => t.type === 'audio');
		if (!audioTrack) {
			audioTrack = this.timeline.addTrack('audio');
			this.createdTrack = true;
		}
		this.audioTrackId = audioTrack.id;

		// Create audio-only clip mirroring the video clip timing
		this.audioClip = {
			...clip,
			id: generateId(),
			type: 'audio',
			name: `${clip.name} (Audio)`,
			trackId: audioTrack.id,
			muted: false,
		};

		audioTrack.clips.push(this.audioClip);

		// Mute original video clip's audio
		clip.muted = true;

		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		if (!this.audioClip || !this.audioTrackId) return;

		// Remove the audio clip
		const audioTrack = this.timeline.getTrackById(this.audioTrackId);
		if (audioTrack) {
			audioTrack.clips = audioTrack.clips.filter((c) => c.id !== this.audioClip!.id);
		}

		// Remove track if we created it and it's now empty
		if (this.createdTrack && audioTrack && audioTrack.clips.length === 0) {
			this.timeline.removeTrack(this.audioTrackId);
		}

		// Restore original clip muted state
		const clip = this.timeline.getClipById(this.clipId);
		if (clip) {
			clip.muted = this.previousMuted;
		}

		this.timeline.tracks = [...this.timeline.tracks];
	}
}
