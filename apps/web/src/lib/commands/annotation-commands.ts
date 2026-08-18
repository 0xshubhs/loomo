import type { Command } from './base-command.js';
import type { Annotation } from '$lib/types/annotations.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

/**
 * Undo/redo for the annotation layer.
 *
 * `timeline.annotations` is reassigned rather than mutated in place throughout:
 * the preview redraws off that array, and pushing into it leaves the effect
 * that owns the repaint unaware anything changed.
 */

export class AddAnnotationCommand implements Command {
	readonly type = 'add-annotation';
	readonly description = 'Add annotation';

	constructor(
		private timeline: TimelineStore,
		private annotation: Annotation
	) {}

	execute(): void {
		this.timeline.annotations = [...this.timeline.annotations, this.annotation];
	}

	undo(): void {
		this.timeline.annotations = this.timeline.annotations.filter((a) => a.id !== this.annotation.id);
	}

	getAnnotationId(): string {
		return this.annotation.id;
	}
}

export class RemoveAnnotationCommand implements Command {
	readonly type = 'remove-annotation';
	readonly description = 'Remove annotation';
	private removed: Annotation | null = null;
	/** Paint order is stored order, so undo has to restore the position too. */
	private index = -1;

	constructor(
		private timeline: TimelineStore,
		private annotationId: string
	) {}

	execute(): void {
		this.index = this.timeline.annotations.findIndex((a) => a.id === this.annotationId);
		if (this.index === -1) return;
		this.removed = this.timeline.annotations[this.index];
		this.timeline.annotations = this.timeline.annotations.filter((a) => a.id !== this.annotationId);
	}

	undo(): void {
		if (!this.removed) return;
		const next = [...this.timeline.annotations];
		next.splice(this.index, 0, this.removed);
		this.timeline.annotations = next;
	}
}

export class UpdateAnnotationCommand implements Command {
	readonly type = 'update-annotation';
	readonly description = 'Update annotation';
	/**
	 * The whole previous annotation, not just the changed keys: they are small
	 * plain objects, and a full snapshot cannot get the restore order wrong.
	 */
	private previous: Annotation | null = null;

	constructor(
		private timeline: TimelineStore,
		private annotationId: string,
		private updates: Partial<Omit<Annotation, 'id'>>
	) {}

	execute(): void {
		const index = this.timeline.annotations.findIndex((a) => a.id === this.annotationId);
		if (index === -1) return;
		this.previous = this.timeline.annotations[index];
		const next = [...this.timeline.annotations];
		next[index] = { ...this.previous, ...this.updates };
		this.timeline.annotations = next;
	}

	undo(): void {
		const previous = this.previous;
		if (!previous) return;
		this.timeline.annotations = this.timeline.annotations.map((a) =>
			a.id === previous.id ? previous : a
		);
	}
}

export class ClearAnnotationsCommand implements Command {
	readonly type = 'clear-annotations';
	readonly description = 'Clear annotations';
	private previous: Annotation[] = [];

	constructor(private timeline: TimelineStore) {}

	execute(): void {
		this.previous = this.timeline.annotations;
		this.timeline.annotations = [];
	}

	undo(): void {
		this.timeline.annotations = this.previous;
	}
}
