import type { Command } from './base-command.js';
import type { TextOverlay } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import { generateId } from '$lib/utils/id.js';

export class AddTextOverlayCommand implements Command {
	readonly type = 'add-text';
	readonly description = 'Add text overlay';
	private overlay: TextOverlay;

	constructor(
		private timeline: TimelineStore,
		private trackId: string,
		private timelineStart: number,
		private duration: number = 5
	) {
		this.overlay = {
			id: generateId(),
			trackId,
			text: 'Text',
			fontFamily: 'Inter',
			fontSize: 48,
			fontWeight: 700,
			color: '#ffffff',
			backgroundColor: 'transparent',
			x: 0.5,
			y: 0.5,
			width: 0.8,
			height: 0.2,
			timelineStart,
			duration,
			opacity: 1,
			alignment: 'center',
		};
	}

	execute(): void {
		this.timeline.textOverlays = [...this.timeline.textOverlays, this.overlay];
	}

	undo(): void {
		this.timeline.textOverlays = this.timeline.textOverlays.filter((t) => t.id !== this.overlay.id);
	}

	getOverlayId(): string {
		return this.overlay.id;
	}
}

export class RemoveTextOverlayCommand implements Command {
	readonly type = 'remove-text';
	readonly description = 'Remove text overlay';
	private removed: TextOverlay | null = null;

	constructor(
		private timeline: TimelineStore,
		private overlayId: string
	) {}

	execute(): void {
		this.removed = this.timeline.textOverlays.find((t) => t.id === this.overlayId) ?? null;
		this.timeline.textOverlays = this.timeline.textOverlays.filter((t) => t.id !== this.overlayId);
	}

	undo(): void {
		if (this.removed) {
			this.timeline.textOverlays = [...this.timeline.textOverlays, this.removed];
		}
	}
}

export class UpdateTextOverlayCommand implements Command {
	readonly type = 'update-text';
	readonly description = 'Update text overlay';
	private previous: Partial<TextOverlay> = {};

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private updates: Partial<TextOverlay>
	) {}

	execute(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) throw new Error(`Text overlay ${this.overlayId} not found`);

		for (const key of Object.keys(this.updates) as (keyof TextOverlay)[]) {
			(this.previous as any)[key] = (overlay as any)[key];
			(overlay as any)[key] = (this.updates as any)[key];
		}
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}

	undo(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) return;

		for (const key of Object.keys(this.previous) as (keyof TextOverlay)[]) {
			(overlay as any)[key] = (this.previous as any)[key];
		}
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}
}
