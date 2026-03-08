export type ClipType = 'video' | 'audio' | 'image' | 'text';
export type TrackType = 'video' | 'audio';

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
