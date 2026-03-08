import type { Command } from './base-command.js';

export class CommandManager {
	undoStack = $state<Command[]>([]);
	redoStack = $state<Command[]>([]);
	private maxHistory = 100;

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	get lastAction(): string | null {
		return this.undoStack.length > 0
			? this.undoStack[this.undoStack.length - 1].description
			: null;
	}

	execute(command: Command): void {
		command.execute();
		this.undoStack = [...this.undoStack, command];
		this.redoStack = [];

		if (this.undoStack.length > this.maxHistory) {
			this.undoStack = this.undoStack.slice(1);
		}
	}

	undo(): void {
		if (this.undoStack.length === 0) return;
		const stack = [...this.undoStack];
		const command = stack.pop()!;
		command.undo();
		this.undoStack = stack;
		this.redoStack = [...this.redoStack, command];
	}

	redo(): void {
		if (this.redoStack.length === 0) return;
		const stack = [...this.redoStack];
		const command = stack.pop()!;
		command.execute();
		this.redoStack = stack;
		this.undoStack = [...this.undoStack, command];
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}
