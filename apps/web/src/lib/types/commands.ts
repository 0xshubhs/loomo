export interface Command {
	readonly type: string;
	readonly description: string;
	execute(): void;
	undo(): void;
}

export type CommandType =
	| 'add-clip'
	| 'remove-clip'
	| 'move-clip'
	| 'split-clip'
	| 'trim-clip'
	| 'add-track'
	| 'remove-track'
	| 'reorder-track'
	| 'add-transition'
	| 'update-transition'
	| 'remove-transition'
	| 'add-text'
	| 'update-text'
	| 'remove-text'
	| 'set-volume'
	| 'mute-track'
	| 'set-property'
	| 'transaction';
