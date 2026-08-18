import { describe, it, expect, beforeEach } from 'vitest';
import {
	AddAnnotationCommand,
	RemoveAnnotationCommand,
	UpdateAnnotationCommand,
	ClearAnnotationsCommand,
} from './annotation-commands.js';
import { createAnnotation } from '$lib/types/annotations.js';
import type { Annotation } from '$lib/types/annotations.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

/** Just enough TimelineStore for the commands under test. */
function makeTimeline(annotations: Annotation[] = []) {
	return { annotations } as unknown as TimelineStore;
}

function makeAnnotation(id: string, overrides: Partial<Annotation> = {}): Annotation {
	return createAnnotation({
		id,
		type: 'pen',
		points: [
			{ x: 0.1, y: 0.1 },
			{ x: 0.9, y: 0.9 },
		],
		startTime: 0,
		endTime: 3,
		...overrides,
	});
}

let timeline: TimelineStore;

beforeEach(() => {
	timeline = makeTimeline();
});

describe('AddAnnotationCommand', () => {
	it('appends the annotation', () => {
		const annotation = makeAnnotation('a1');
		new AddAnnotationCommand(timeline, annotation).execute();
		expect(timeline.annotations).toEqual([annotation]);
	});

	it('undoes back to nothing', () => {
		const command = new AddAnnotationCommand(timeline, makeAnnotation('a1'));
		command.execute();
		command.undo();
		expect(timeline.annotations).toEqual([]);
	});

	it('redoes onto the end again', () => {
		const command = new AddAnnotationCommand(timeline, makeAnnotation('a2'));
		timeline.annotations = [makeAnnotation('a1')];
		command.execute();
		command.undo();
		command.execute();
		expect(timeline.annotations.map((a) => a.id)).toEqual(['a1', 'a2']);
	});

	it('replaces the array rather than mutating it', () => {
		// The preview repaints off this reference; pushing in place leaves the
		// effect that owns the repaint unaware anything happened.
		const before = timeline.annotations;
		new AddAnnotationCommand(timeline, makeAnnotation('a1')).execute();
		expect(timeline.annotations).not.toBe(before);
	});

	it('exposes the id it created', () => {
		const command = new AddAnnotationCommand(timeline, makeAnnotation('a1'));
		expect(command.getAnnotationId()).toBe('a1');
	});
});

describe('RemoveAnnotationCommand', () => {
	beforeEach(() => {
		timeline = makeTimeline([makeAnnotation('a1'), makeAnnotation('a2'), makeAnnotation('a3')]);
	});

	it('removes only the named annotation', () => {
		new RemoveAnnotationCommand(timeline, 'a2').execute();
		expect(timeline.annotations.map((a) => a.id)).toEqual(['a1', 'a3']);
	});

	it('restores it at its original position, not at the end', () => {
		// Stored order is paint order, so undo has to put the mark back under
		// whatever was on top of it.
		const command = new RemoveAnnotationCommand(timeline, 'a2');
		command.execute();
		command.undo();
		expect(timeline.annotations.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
	});

	it('is a no-op for an unknown id, including on undo', () => {
		const command = new RemoveAnnotationCommand(timeline, 'nope');
		command.execute();
		expect(timeline.annotations).toHaveLength(3);
		command.undo();
		expect(timeline.annotations.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
	});
});

describe('UpdateAnnotationCommand', () => {
	beforeEach(() => {
		timeline = makeTimeline([makeAnnotation('a1', { color: '#ff0000', strokeWidth: 6 })]);
	});

	it('applies a partial change and leaves the rest alone', () => {
		new UpdateAnnotationCommand(timeline, 'a1', { color: '#00ff00' }).execute();
		expect(timeline.annotations[0].color).toBe('#00ff00');
		expect(timeline.annotations[0].strokeWidth).toBe(6);
	});

	it('undoes every changed field at once', () => {
		const command = new UpdateAnnotationCommand(timeline, 'a1', {
			color: '#0000ff',
			strokeWidth: 20,
			endTime: 12,
		});
		command.execute();
		command.undo();
		expect(timeline.annotations[0]).toMatchObject({
			color: '#ff0000',
			strokeWidth: 6,
			endTime: 3,
		});
	});

	it('undoes to the state before this command, not to the original', () => {
		new UpdateAnnotationCommand(timeline, 'a1', { color: '#111111' }).execute();
		const second = new UpdateAnnotationCommand(timeline, 'a1', { color: '#222222' });
		second.execute();
		second.undo();
		expect(timeline.annotations[0].color).toBe('#111111');
	});

	it('keeps the annotation in place in the list', () => {
		timeline = makeTimeline([makeAnnotation('a1'), makeAnnotation('a2'), makeAnnotation('a3')]);
		new UpdateAnnotationCommand(timeline, 'a2', { color: '#123456' }).execute();
		expect(timeline.annotations.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
	});

	it('is a no-op for an unknown id', () => {
		const command = new UpdateAnnotationCommand(timeline, 'nope', { color: '#000000' });
		command.execute();
		command.undo();
		expect(timeline.annotations[0].color).toBe('#ff0000');
	});

	it('can retime an annotation to a zero-length range and back', () => {
		const command = new UpdateAnnotationCommand(timeline, 'a1', { startTime: 5, endTime: 5 });
		command.execute();
		expect(timeline.annotations[0]).toMatchObject({ startTime: 5, endTime: 5 });
		command.undo();
		expect(timeline.annotations[0]).toMatchObject({ startTime: 0, endTime: 3 });
	});
});

describe('ClearAnnotationsCommand', () => {
	it('empties the list and puts it back in order', () => {
		timeline = makeTimeline([makeAnnotation('a1'), makeAnnotation('a2')]);
		const command = new ClearAnnotationsCommand(timeline);
		command.execute();
		expect(timeline.annotations).toEqual([]);
		command.undo();
		expect(timeline.annotations.map((a) => a.id)).toEqual(['a1', 'a2']);
	});

	it('is harmless when there is nothing to clear', () => {
		const command = new ClearAnnotationsCommand(timeline);
		command.execute();
		command.undo();
		expect(timeline.annotations).toEqual([]);
	});
});
