import type { KeyframeTrack } from './keyframes.js';
import { DEFAULT_VIDEO_EFFECT, type VideoEffect } from './effects.js';

export type ClipType = 'video' | 'audio' | 'image' | 'text';
export type TrackType = 'video' | 'audio';
export type RotationAngle = 0 | 90 | 180 | 270;

/**
 * A rectangular region obscured for privacy — VN calls this Mosaic.
 *
 * Coordinates are percentages of the frame so a region keeps its place when
 * the project is exported at a different resolution.
 */
export interface MosaicRegion {
	id: string;
	x: number;      // 0-100 percentage
	y: number;      // 0-100 percentage
	width: number;  // 0-100 percentage
	height: number; // 0-100 percentage
	mode: 'pixelate' | 'blur';
	/** 1-100. Pixel block size for pixelate, blur radius for blur. */
	strength: number;
	/** Seconds from clip start. null means the whole clip. */
	startTime: number | null;
	endTime: number | null;
}

/**
 * Time remapping with a ramp, rather than one constant rate.
 *
 * Each point maps a position in the clip to a playback multiplier; FFmpeg
 * renders it as a piecewise `setpts` expression.
 */
export interface SpeedPoint {
	id: string;
	/** Seconds from clip start. */
	time: number;
	/** Playback multiplier: 1 = normal, 2 = double speed, 0.5 = half. */
	speed: number;
}

export interface SpeedCurve {
	enabled: boolean;
	points: SpeedPoint[];
	/** Keeps audio pitch constant while the rate changes. */
	preservePitch: boolean;
}

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
	denoiseStrength: number;   // 0-100, 0 = off (audio afftdn)
	chromaKey: ChromaKey;
	reversed: boolean;
	position: ClipPosition;
	groupId: string | null;
	videoEffect: VideoEffect;
	/** Per-property animation curves. Empty when the clip is not animated. */
	keyframes: KeyframeTrack[];
	/** Pixelate/blur regions, for hiding faces or sensitive on-screen data. */
	mosaics: MosaicRegion[];
	speedCurve: SpeedCurve | null;
}

/**
 * Builds a clip with every field defaulted.
 *
 * Clips used to be spelled out as object literals at each call site, which is
 * how two of them drifted out of sync with the type. Adding a field here now
 * reaches every construction site at once.
 */
export function createClip(overrides: CreateClipInput): Clip {
	return {
		id: overrides.id,
		name: overrides.name,
		type: overrides.type,
		assetId: overrides.assetId,
		trackId: overrides.trackId,
		timelineStart: overrides.timelineStart,
		duration: overrides.duration,
		sourceStart: overrides.sourceStart ?? 0,
		sourceEnd: overrides.sourceEnd ?? overrides.duration,
		volume: overrides.volume ?? 1,
		muted: overrides.muted ?? false,
		speed: overrides.speed ?? 1,
		opacity: overrides.opacity ?? 1,
		filters: { ...DEFAULT_CLIP_FILTERS, ...overrides.filters },
		filterPreset: overrides.filterPreset ?? null,
		transform: { ...DEFAULT_TRANSFORM, ...overrides.transform },
		crop: { ...DEFAULT_CROP, ...overrides.crop },
		fadeIn: overrides.fadeIn ?? 0,
		fadeOut: overrides.fadeOut ?? 0,
		noiseSuppression: overrides.noiseSuppression ?? false,
		denoiseStrength: overrides.denoiseStrength ?? 0,
		chromaKey: { ...DEFAULT_CHROMA_KEY, ...overrides.chromaKey },
		reversed: overrides.reversed ?? false,
		position: { ...DEFAULT_CLIP_POSITION, ...overrides.position },
		groupId: overrides.groupId ?? null,
		videoEffect: { ...DEFAULT_VIDEO_EFFECT, ...overrides.videoEffect },
		keyframes: overrides.keyframes ?? [],
		mosaics: overrides.mosaics ?? [],
		speedCurve: overrides.speedCurve ?? null,
	};
}

type CreateClipInput = Pick<
	Clip,
	'id' | 'name' | 'type' | 'assetId' | 'trackId' | 'timelineStart' | 'duration'
> &
	Partial<Omit<Clip, 'id' | 'name' | 'type' | 'assetId' | 'trackId' | 'timelineStart' | 'duration'>>;

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
