import { describe, it, expect } from 'vitest';
import { CommandManager } from './command-manager.svelte.js';
import type { Command } from './base-command.js';

/**
 * The revision counter is what tells the editor a project differs from the one
 * on disk. Before it existed, `markDirty` was reached only by the project-name
 * field and the aspect-ratio picker — so trimming, splitting, deleting and
 * dragging clips all left the project looking saved, the leave prompt never
 * appeared for the case it was written for, and autosave had nothing to fire
 * on.
 */

function command(): Command {
	return {
		description: 'test',
		execute() {},
		undo() {},
	} as Command;
}

describe('tracking that something changed', () => {
	it('starts at zero, because nothing has happened', () => {
		expect(new CommandManager().revision).toBe(0);
	});

	it('counts an edit', () => {
		const commands = new CommandManager();

		commands.execute(command());

		expect(commands.revision).toBe(1);
	});

	it('counts an undo as a change, not as a return to saved', () => {
		// Undoing back to an empty stack still leaves a project that differs
		// from the file, which is why stack length cannot stand in for this.
		const commands = new CommandManager();
		commands.execute(command());

		commands.undo();

		expect(commands.undoStack).toHaveLength(0);
		expect(commands.revision).toBe(2);
	});

	it('counts a redo', () => {
		const commands = new CommandManager();
		commands.execute(command());
		commands.undo();

		commands.redo();

		expect(commands.revision).toBe(3);
	});

	it('does not count an undo with nothing to undo', () => {
		const commands = new CommandManager();

		commands.undo();

		expect(commands.revision).toBe(0);
	});

	it('does not count a redo with nothing to redo', () => {
		const commands = new CommandManager();

		commands.redo();

		expect(commands.revision).toBe(0);
	});

	it('resets when a project is opened', () => {
		// clear() runs after a load; the freshly opened project matches disk.
		const commands = new CommandManager();
		commands.execute(command());

		commands.clear();

		expect(commands.revision).toBe(0);
	});
});
