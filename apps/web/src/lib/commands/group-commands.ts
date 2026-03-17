import type { Command } from './base-command.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

export class GroupClipsCommand implements Command {
	readonly type = 'group-clips';
	readonly description = 'Group clips';
	private groupId: string | null = null;
	private clipIds: string[];

	constructor(
		private timeline: TimelineStore,
		clipIds: Set<string>
	) {
		this.clipIds = [...clipIds];
	}

	execute(): void {
		this.groupId = this.timeline.groupSelectedClips(new Set(this.clipIds));
	}

	undo(): void {
		if (this.groupId) {
			this.timeline.ungroupClips(this.groupId);
		}
	}
}

export class UngroupClipsCommand implements Command {
	readonly type = 'ungroup-clips';
	readonly description = 'Ungroup clips';
	private previousGroupId: string;
	private clipIds: string[] = [];

	constructor(
		private timeline: TimelineStore,
		groupId: string
	) {
		this.previousGroupId = groupId;
	}

	execute(): void {
		const clips = this.timeline.getGroupClips(this.previousGroupId);
		this.clipIds = clips.map((c) => c.id);
		this.timeline.ungroupClips(this.previousGroupId);
	}

	undo(): void {
		for (const track of this.timeline.tracks) {
			for (const clip of track.clips) {
				if (this.clipIds.includes(clip.id)) {
					clip.groupId = this.previousGroupId;
				}
			}
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}
}
