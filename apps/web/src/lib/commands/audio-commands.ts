import type { Command } from './base-command.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

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
