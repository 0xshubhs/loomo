export interface Command {
	readonly type: string;
	readonly description: string;
	execute(): void;
	undo(): void;
}
