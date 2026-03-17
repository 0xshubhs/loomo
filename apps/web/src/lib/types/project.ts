export interface AspectRatio {
	width: number;
	height: number;
	label: string;
}

export interface ProjectState {
	name: string;
	createdAt: number;
	dirty: boolean;
	aspectRatio: AspectRatio;
}
