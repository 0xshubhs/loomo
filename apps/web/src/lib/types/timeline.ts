export type ClipType = 'video' | 'audio' | 'image' | 'text';
export type TrackType = 'video' | 'audio';
export type RotationAngle = 0 | 90 | 180 | 270;

export interface ClipFilters {
	brightness: number;  // 0-200, default 100
	contrast: number;    // 0-200, default 100
	saturation: number;  // 0-200, default 100
	hue: number;         // 0-360, default 0
	blur: number;        // 0-20, default 0
	opacity: number;     // 0-100, default 100
	exposure: number;    // -100 to 100, default 0
	temperature: number; // -100 to 100, default 0
}

export const DEFAULT_CLIP_FILTERS: ClipFilters = {
	brightness: 100,
	contrast: 100,
	saturation: 100,
	hue: 0,
	blur: 0,
	opacity: 100,
	exposure: 0,
	temperature: 0,
};

export interface ClipTransform {
	rotation: RotationAngle;
	flipH: boolean;
	flipV: boolean;
}

export interface ClipCrop {
	top: number;    // 0-100 percentage
	right: number;  // 0-100 percentage
	bottom: number; // 0-100 percentage
	left: number;   // 0-100 percentage
}

export const DEFAULT_TRANSFORM: ClipTransform = {
	rotation: 0,
	flipH: false,
	flipV: false,
};

export const DEFAULT_CROP: ClipCrop = {
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
};

export interface ChromaKey {
	enabled: boolean;
	color: 'green' | 'blue' | 'red' | string;
	threshold: number;  // 0.0 - 1.0
	smoothing: number;  // 0.0 - 0.5
}

export const DEFAULT_CHROMA_KEY: ChromaKey = {
	enabled: false,
	color: 'green',
	threshold: 0.4,
	smoothing: 0.1,
};

export interface ClipPosition {
	x: number;       // 0-100 percentage
	y: number;       // 0-100 percentage
	width: number;   // 0-100 percentage
	height: number;  // 0-100 percentage
	zIndex: number;
}

export const DEFAULT_CLIP_POSITION: ClipPosition = {
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	zIndex: 0,
};

export interface Clip {
	id: string;
	name: string;
	type: ClipType;
	assetId: string;
	trackId: string;
	timelineStart: number;
	duration: number;
	sourceStart: number;
	sourceEnd: number;
	volume: number;
	muted: boolean;
	speed: number;
	opacity: number;
	filters: ClipFilters;
	filterPreset: string | null;
	transform: ClipTransform;
	crop: ClipCrop;
	fadeIn: number;            // seconds, 0 = no fade, default 0
	fadeOut: number;           // seconds, 0 = no fade, default 0
	noiseSuppression: boolean; // default false
	chromaKey: ChromaKey;
	reversed: boolean;
	position: ClipPosition;
	groupId: string | null;
	videoEffect: { type: string; intensity: number };
}

export interface Track {
	id: string;
	name: string;
	type: TrackType;
	clips: Clip[];
	muted: boolean;
	locked: boolean;
	visible: boolean;
	height: number;
	volume: number;
}

export interface TimelineState {
	tracks: Track[];
	duration: number;
}

export interface SnapPoint {
	time: number;
	source: 'clip-start' | 'clip-end' | 'playhead' | 'marker';
	clipId?: string;
}
