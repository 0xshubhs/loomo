import type { Command } from './base-command.js';
import type { Transition, TransitionType } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import { generateId } from '$lib/utils/id.js';

export class AddTransitionCommand implements Command {
	readonly type = 'add-transition';
	readonly description = 'Add transition';
	private transition: Transition;

	constructor(
		private timeline: TimelineStore,
		private clipAId: string,
		private clipBId: string,
		private trackId: string,
		private transitionType: TransitionType,
		private duration: number = 0.5
	) {
		this.transition = {
			id: generateId(),
			type: transitionType,
			duration,
			clipAId,
			clipBId,
			trackId,
		};
	}

	execute(): void {
		this.timeline.transitions = [...this.timeline.transitions, this.transition];
	}

	undo(): void {
		this.timeline.transitions = this.timeline.transitions.filter((t) => t.id !== this.transition.id);
	}
}

export class RemoveTransitionCommand implements Command {
	readonly type = 'remove-transition';
	readonly description = 'Remove transition';
	private removed: Transition | null = null;

	constructor(
		private timeline: TimelineStore,
		private transitionId: string
	) {}

	execute(): void {
		this.removed = this.timeline.transitions.find((t) => t.id === this.transitionId) ?? null;
		this.timeline.transitions = this.timeline.transitions.filter((t) => t.id !== this.transitionId);
	}

	undo(): void {
		if (this.removed) {
			this.timeline.transitions = [...this.timeline.transitions, this.removed];
		}
	}
}

export class UpdateTransitionCommand implements Command {
	readonly type = 'update-transition';
	readonly description = 'Update transition';
	private previousType: TransitionType | null = null;
	private previousDuration: number = 0;

	constructor(
		private timeline: TimelineStore,
		private transitionId: string,
		private newType?: TransitionType,
		private newDuration?: number
	) {}

	execute(): void {
		const t = this.timeline.transitions.find((tr) => tr.id === this.transitionId);
		if (!t) throw new Error(`Transition ${this.transitionId} not found`);
		this.previousType = t.type;
		this.previousDuration = t.duration;
		if (this.newType) t.type = this.newType;
		if (this.newDuration !== undefined) t.duration = this.newDuration;
		this.timeline.transitions = [...this.timeline.transitions];
	}

	undo(): void {
		const t = this.timeline.transitions.find((tr) => tr.id === this.transitionId);
		if (!t || this.previousType === null) return;
		t.type = this.previousType;
		t.duration = this.previousDuration;
		this.timeline.transitions = [...this.timeline.transitions];
	}
}
