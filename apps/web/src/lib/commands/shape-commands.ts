import type { Command } from './base-command.js';
import type { ShapeOverlay } from '$lib/types/index.js';
import { DEFAULT_SHAPE_OVERLAY } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import { generateId } from '$lib/utils/id.js';

export class AddShapeOverlayCommand implements Command {
	readonly type = 'add-shape';
	readonly description = 'Add shape overlay';
	private overlay: ShapeOverlay;

	constructor(
		private timeline: TimelineStore,
		private shapeId: string,
		private startTime: number,
		private duration: number = 5
	) {
		this.overlay = {
			...DEFAULT_SHAPE_OVERLAY,
			id: generateId(),
			shapeId,
			startTime,
			duration,
		};
	}

	execute(): void {
		this.timeline.shapeOverlays = [...this.timeline.shapeOverlays, this.overlay];
	}

	undo(): void {
		this.timeline.shapeOverlays = this.timeline.shapeOverlays.filter((s) => s.id !== this.overlay.id);
	}

	getOverlayId(): string {
		return this.overlay.id;
	}
}

export class RemoveShapeOverlayCommand implements Command {
	readonly type = 'remove-shape';
	readonly description = 'Remove shape overlay';
	private removed: ShapeOverlay | null = null;

	constructor(
		private timeline: TimelineStore,
		private overlayId: string
	) {}

	execute(): void {
		this.removed = this.timeline.shapeOverlays.find((s) => s.id === this.overlayId) ?? null;
		this.timeline.shapeOverlays = this.timeline.shapeOverlays.filter((s) => s.id !== this.overlayId);
	}

	undo(): void {
		if (this.removed) {
			this.timeline.shapeOverlays = [...this.timeline.shapeOverlays, this.removed];
		}
	}
}

export class UpdateShapeOverlayCommand implements Command {
	readonly type = 'update-shape';
	readonly description = 'Update shape overlay';
	private previous: Partial<ShapeOverlay> = {};

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private updates: Partial<ShapeOverlay>
	) {}

	execute(): void {
		const overlay = this.timeline.shapeOverlays.find((s) => s.id === this.overlayId);
		if (!overlay) throw new Error(`Shape overlay ${this.overlayId} not found`);

		for (const key of Object.keys(this.updates) as (keyof ShapeOverlay)[]) {
			(this.previous as any)[key] = (overlay as any)[key];
			(overlay as any)[key] = (this.updates as any)[key];
		}
		this.timeline.shapeOverlays = [...this.timeline.shapeOverlays];
	}

	undo(): void {
		const overlay = this.timeline.shapeOverlays.find((s) => s.id === this.overlayId);
		if (!overlay) return;

		for (const key of Object.keys(this.previous) as (keyof ShapeOverlay)[]) {
			(overlay as any)[key] = (this.previous as any)[key];
		}
		this.timeline.shapeOverlays = [...this.timeline.shapeOverlays];
	}
}
