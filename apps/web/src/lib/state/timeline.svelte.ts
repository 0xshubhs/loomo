import type { Track, Clip } from '$lib/types/index.js';
import type { Transition, TextOverlay } from '$lib/types/index.js';
import { generateId } from '$lib/utils/id.js';

export class TimelineStore {
	tracks = $state<Track[]>([]);
	transitions = $state<Transition[]>([]);
	textOverlays = $state<TextOverlay[]>([]);

	get totalDuration(): number {
		if (this.tracks.length === 0) return 0;
		let max = 0;
		for (const track of this.tracks) {
			for (const clip of track.clips) {
				const end = clip.timelineStart + clip.duration;
				if (end > max) max = end;
			}
		}
		for (const overlay of this.textOverlays) {
			const end = overlay.timelineStart + overlay.duration;
			if (end > max) max = end;
		}
		return max;
	}

	get flatClips(): Clip[] {
		return this.tracks.flatMap((t) => t.clips);
	}

	getTrackById(id: string): Track | undefined {
		return this.tracks.find((t) => t.id === id);
	}

	getClipById(id: string): Clip | undefined {
		for (const track of this.tracks) {
			const clip = track.clips.find((c) => c.id === id);
			if (clip) return clip;
		}
		return undefined;
	}

	getClipTrack(clipId: string): Track | undefined {
		return this.tracks.find((t) => t.clips.some((c) => c.id === clipId));
	}

	addTrack(type: 'video' | 'audio', name?: string): Track {
		const track: Track = {
			id: generateId(),
			name: name ?? `${type === 'video' ? 'Video' : 'Audio'} ${this.tracks.filter((t) => t.type === type).length + 1}`,
			type,
			clips: [],
			muted: false,
			locked: false,
			visible: true,
			height: 80,
			volume: 1,
		};
		this.tracks.push(track);
		return track;
	}

	removeTrack(trackId: string): void {
		this.tracks = this.tracks.filter((t) => t.id !== trackId);
	}

	getTransitionBetween(clipAId: string, clipBId: string): Transition | undefined {
		return this.transitions.find(
			(t) =>
				(t.clipAId === clipAId && t.clipBId === clipBId) ||
				(t.clipAId === clipBId && t.clipBId === clipAId)
		);
	}

	clear(): void {
		this.tracks = [];
		this.transitions = [];
		this.textOverlays = [];
	}
}
