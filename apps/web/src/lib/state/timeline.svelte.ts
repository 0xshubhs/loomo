import type { Track, Clip } from '$lib/types/index.js';
import type { Transition, TextOverlay, ShapeOverlay } from '$lib/types/index.js';
import type { Annotation } from '$lib/types/annotations.js';
import { generateId } from '$lib/utils/id.js';

export class TimelineStore {
	tracks = $state<Track[]>([]);
	transitions = $state<Transition[]>([]);
	textOverlays = $state<TextOverlay[]>([]);
	shapeOverlays = $state<ShapeOverlay[]>([]);
	/**
	 * Freehand drawings over the frame. They sit on the timeline rather than on
	 * a clip because a stroke commonly spans a cut, and re-parenting it every
	 * time the clip beneath is split or moved would lose it.
	 */
	annotations = $state<Annotation[]>([]);

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
		for (const shape of this.shapeOverlays) {
			const end = shape.startTime + shape.duration;
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

	getAnnotationById(id: string): Annotation | undefined {
		return this.annotations.find((a) => a.id === id);
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

	groupSelectedClips(clipIds: Set<string>): string | null {
		if (clipIds.size < 2) return null;
		const groupId = generateId();
		for (const track of this.tracks) {
			for (const clip of track.clips) {
				if (clipIds.has(clip.id)) {
					clip.groupId = groupId;
				}
			}
		}
		this.tracks = [...this.tracks];
		return groupId;
	}

	ungroupClips(groupId: string): void {
		for (const track of this.tracks) {
			for (const clip of track.clips) {
				if (clip.groupId === groupId) {
					clip.groupId = null;
				}
			}
		}
		this.tracks = [...this.tracks];
	}

	getGroupClips(groupId: string): Clip[] {
		const clips: Clip[] = [];
		for (const track of this.tracks) {
			for (const clip of track.clips) {
				if (clip.groupId === groupId) {
					clips.push(clip);
				}
			}
		}
		return clips;
	}

	/** Remove all gaps between clips on a track by shifting clips left. */
	removeGapsOnTrack(trackId: string): void {
		const track = this.getTrackById(trackId);
		if (!track) return;
		const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
		let cursor = 0;
		for (const clip of sorted) {
			clip.timelineStart = cursor;
			cursor += clip.duration;
		}
		this.tracks = [...this.tracks];
	}

	/** Remove all gaps across all tracks. */
	removeAllGaps(): void {
		for (const track of this.tracks) {
			const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
			let cursor = 0;
			for (const clip of sorted) {
				clip.timelineStart = cursor;
				cursor += clip.duration;
			}
		}
		this.tracks = [...this.tracks];
	}

	/** Remove a single gap on a track at a specific time. */
	removeGapAt(trackId: string, time: number): void {
		const track = this.getTrackById(trackId);
		if (!track) return;
		const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
		// Find the gap that contains `time`
		for (let i = 0; i < sorted.length; i++) {
			const clip = sorted[i];
			const prevEnd = i === 0 ? 0 : sorted[i - 1].timelineStart + sorted[i - 1].duration;
			if (time >= prevEnd && time < clip.timelineStart) {
				// Found the gap — shift this clip and all subsequent clips left
				const gapSize = clip.timelineStart - prevEnd;
				for (let j = i; j < sorted.length; j++) {
					sorted[j].timelineStart -= gapSize;
				}
				break;
			}
		}
		this.tracks = [...this.tracks];
	}

	clear(): void {
		this.tracks = [];
		this.transitions = [];
		this.textOverlays = [];
		this.shapeOverlays = [];
		this.annotations = [];
	}
}
