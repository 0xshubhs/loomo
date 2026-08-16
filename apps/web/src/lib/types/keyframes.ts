/**
 * Keyframe animation model.
 *
 * A keyframe track animates one numeric property of one clip over time.
 * Times are seconds relative to the clip's own start, so trimming or moving a
 * clip on the timeline never invalidates its animation — which also matches
 * what FFmpeg's `t` variable means after `trim` + `setpts=PTS-STARTPTS`.
 */

export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export const EASING_LABELS: Record<EasingType, string> = {
	linear: 'Linear',
	'ease-in': 'Ease In',
	'ease-out': 'Ease Out',
	'ease-in-out': 'Ease In Out',
	hold: 'Hold',
};

export interface Keyframe {
	id: string;
	/** Seconds from the start of the clip. */
	time: number;
	value: number;
	/** Easing applied on the segment *leaving* this keyframe. */
	easing: EasingType;
}

export type AnimatableProperty =
	| 'positionX'
	| 'positionY'
	| 'scale'
	| 'rotation'
	| 'opacity'
	| 'volume'
	| 'brightness'
	| 'contrast'
	| 'saturation';

export interface KeyframeTrack {
	property: AnimatableProperty;
	keyframes: Keyframe[];
}

/**
 * How a property reaches the encoder.
 *
 * `geometry` and `color` properties compile to per-frame FFmpeg expressions.
 * `alpha` has no expression-capable filter, so it is driven by a generated
 * sendcmd script instead — see `compileAlphaCommands`.
 */
export type PropertyTarget = 'geometry' | 'color' | 'audio' | 'alpha';

export interface AnimatablePropertyDef {
	id: AnimatableProperty;
	label: string;
	min: number;
	max: number;
	step: number;
	/** Value used when the property has no keyframes. */
	fallback: number;
	unit: string;
	target: PropertyTarget;
}

export const ANIMATABLE_PROPERTIES: Record<AnimatableProperty, AnimatablePropertyDef> = {
	positionX: { id: 'positionX', label: 'Position X', min: -200, max: 200, step: 0.5, fallback: 0, unit: '%', target: 'geometry' },
	positionY: { id: 'positionY', label: 'Position Y', min: -200, max: 200, step: 0.5, fallback: 0, unit: '%', target: 'geometry' },
	scale: { id: 'scale', label: 'Scale', min: 1, max: 400, step: 1, fallback: 100, unit: '%', target: 'geometry' },
	rotation: { id: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1, fallback: 0, unit: '°', target: 'geometry' },
	opacity: { id: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, fallback: 100, unit: '%', target: 'alpha' },
	volume: { id: 'volume', label: 'Volume', min: 0, max: 200, step: 1, fallback: 100, unit: '%', target: 'audio' },
	brightness: { id: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, fallback: 100, unit: '%', target: 'color' },
	contrast: { id: 'contrast', label: 'Contrast', min: 0, max: 200, step: 1, fallback: 100, unit: '%', target: 'color' },
	saturation: { id: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, fallback: 100, unit: '%', target: 'color' },
};

export const ANIMATABLE_PROPERTY_LIST: AnimatablePropertyDef[] = Object.values(ANIMATABLE_PROPERTIES);

/** Properties that only make sense on a track that carries audio. */
export const AUDIO_PROPERTIES: AnimatableProperty[] = ['volume'];
