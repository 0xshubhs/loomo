export type TransitionType =
	| 'fade'
	| 'dissolve'
	| 'wipe-left'
	| 'wipe-right'
	| 'wipe-up'
	| 'wipe-down'
	| 'slide-left'
	| 'slide-right'
	| 'zoom-in'
	| 'zoom-out'
	| 'blur';

export interface Transition {
	id: string;
	type: TransitionType;
	duration: number;
	clipAId: string;
	clipBId: string;
	trackId: string;
}

export interface TextOverlay {
	id: string;
	trackId: string;
	text: string;
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	color: string;
	backgroundColor: string;
	x: number;
	y: number;
	width: number;
	height: number;
	timelineStart: number;
	duration: number;
	opacity: number;
	alignment: 'left' | 'center' | 'right';
}

export interface Filter {
	id: string;
	type: string;
	params: Record<string, number | string | boolean>;
}
