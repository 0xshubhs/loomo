import type { Command } from './base-command.js';

export class TransactionCommand implements Command {
	readonly type = 'transaction';
	readonly description: string;
	private commands: Command[];
	private executedCount = 0;

	constructor(description: string, commands: Command[]) {
		this.description = description;
		this.commands = commands;
	}

	execute(): void {
		this.executedCount = 0;
		try {
			for (const cmd of this.commands) {
				cmd.execute();
				this.executedCount++;
			}
		} catch (error) {
			this.rollback();
			throw error;
		}
	}

	undo(): void {
		for (let i = this.commands.length - 1; i >= 0; i--) {
			this.commands[i].undo();
		}
	}

	private rollback(): void {
		for (let i = this.executedCount - 1; i >= 0; i--) {
			try {
				this.commands[i].undo();
			} catch {
				console.error(`Rollback failed for command ${i}`);
			}
		}
	}
}
