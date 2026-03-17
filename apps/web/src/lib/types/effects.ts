export type TransitionType =
	// Fades
	| 'fade'
	| 'dissolve'
	| 'fade-white'
	| 'fade-black'
	// Wipes
	| 'wipe-left'
	| 'wipe-right'
	| 'wipe-up'
	| 'wipe-down'
	| 'wipe-circular'
	| 'wipe-diagonal'
	// Slides / Push
	| 'slide-left'
	| 'slide-right'
	| 'push-left'
	| 'push-right'
	| 'push-up'
	| 'push-down'
	// Zoom
	| 'zoom-in'
	| 'zoom-out'
	// Creative
	| 'blur'
	| 'spin'
	| 'glitch'
	| 'pixelate'
	| 'blinds'
	| 'iris'
	| 'heart'
	| 'fire'
	| 'page-turn'
	| 'cross-blur'
	| 'morph';

export interface Transition {
	id: string;
	type: TransitionType;
	duration: number;
	clipAId: string;
	clipBId: string;
	trackId: string;
}

export type TextAnimation =
	| 'none'
	| 'fadeIn'
	| 'slideUp'
	| 'slideDown'
	| 'slideLeft'
	| 'slideRight'
	| 'scaleIn'
	| 'typewriter';

export interface TextShadow {
	enabled: boolean;
	color: string;
	offsetX: number;
	offsetY: number;
	blur: number;
}

export interface TextOutline {
	enabled: boolean;
	color: string;
	width: number;
}

export const DEFAULT_TEXT_SHADOW: TextShadow = {
	enabled: false,
	color: '#000000',
	offsetX: 2,
	offsetY: 2,
	blur: 4,
};

export const DEFAULT_TEXT_OUTLINE: TextOutline = {
	enabled: false,
	color: '#000000',
	width: 2,
};

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
	shadow: TextShadow;
	outline: TextOutline;
	animation: TextAnimation;
	letterSpacing: number;  // px, default 0
	lineHeight: number;     // multiplier, default 1.2
}

export interface ShapeOverlay {
	id: string;
	shapeId: string;
	x: number;          // 0-100 percent
	y: number;          // 0-100 percent
	width: number;      // pixels
	height: number;     // pixels
	rotation: number;   // degrees
	fillColor: string;
	strokeColor: string;
	strokeWidth: number;
	opacity: number;    // 0-1
	startTime: number;
	duration: number;
}

export const DEFAULT_SHAPE_OVERLAY: Omit<ShapeOverlay, 'id' | 'shapeId'> = {
	x: 50,
	y: 50,
	width: 150,
	height: 150,
	rotation: 0,
	fillColor: '#ffffff',
	strokeColor: '#000000',
	strokeWidth: 0,
	opacity: 1,
	startTime: 0,
	duration: 5,
};

export interface Filter {
	id: string;
	type: string;
	params: Record<string, number | string | boolean>;
}

export interface CaptionSegment {
	id: string;
	text: string;
	startTime: number;  // seconds
	endTime: number;    // seconds
}

export interface CaptionStyle {
	fontFamily: string;
	fontSize: number;        // px
	fontColor: string;
	backgroundColor: string; // e.g., 'rgba(0,0,0,0.7)' or 'transparent'
	position: 'bottom' | 'top' | 'center';
	alignment: 'left' | 'center' | 'right';
}

export interface CaptionTrack {
	segments: CaptionSegment[];
	style: CaptionStyle;
	enabled: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
	fontFamily: 'Arial',
	fontSize: 24,
	fontColor: '#ffffff',
	backgroundColor: 'rgba(0,0,0,0.7)',
	position: 'bottom',
	alignment: 'center',
};

// ── Video Effects ──────────────────────────────────────────────────

export type VideoEffectType =
	| 'none'
	| 'blur'
	| 'vhs'
	| 'glitch'
	| 'filmic'
	| 'glow'
	| 'vaporwave'
	| 'flash'
	| 'pulse'
	| 'kaleidoscope'
	| 'bokeh'
	| 'mirror'
	| 'cinematic';

export interface VideoEffect {
	type: VideoEffectType;
	intensity: number; // 0-100
}

export const DEFAULT_VIDEO_EFFECT: VideoEffect = {
	type: 'none',
	intensity: 50,
};

export const VIDEO_EFFECT_LIST: { type: VideoEffectType; label: string; color: string }[] = [
	{ type: 'none', label: 'None', color: '#555555' },
	{ type: 'blur', label: 'Blur', color: '#8888cc' },
	{ type: 'vhs', label: 'VHS', color: '#cc6644' },
	{ type: 'glitch', label: 'Glitch', color: '#44ccaa' },
	{ type: 'filmic', label: 'Filmic', color: '#998866' },
	{ type: 'glow', label: 'Glow', color: '#eedd88' },
	{ type: 'vaporwave', label: 'Vaporwave', color: '#cc66ff' },
	{ type: 'flash', label: 'Flash', color: '#ffffff' },
	{ type: 'pulse', label: 'Pulse', color: '#ff4488' },
	{ type: 'kaleidoscope', label: 'Kaleidoscope', color: '#66ccdd' },
	{ type: 'bokeh', label: 'Bokeh', color: '#aabb66' },
	{ type: 'mirror', label: 'Mirror', color: '#6688cc' },
	{ type: 'cinematic', label: 'Cinematic', color: '#334455' },
];

// ── Transition categories ──────────────────────────────────────────

export type TransitionCategory = 'fades' | 'wipes' | 'slides' | 'zooms' | 'creative';

export interface TransitionInfo {
	type: TransitionType;
	label: string;
	category: TransitionCategory;
}

export const TRANSITION_LIST: TransitionInfo[] = [
	// Fades
	{ type: 'fade', label: 'Fade', category: 'fades' },
	{ type: 'dissolve', label: 'Dissolve', category: 'fades' },
	{ type: 'fade-white', label: 'Fade White', category: 'fades' },
	{ type: 'fade-black', label: 'Fade Black', category: 'fades' },
	{ type: 'cross-blur', label: 'Cross Blur', category: 'fades' },
	// Wipes
	{ type: 'wipe-left', label: 'Wipe Left', category: 'wipes' },
	{ type: 'wipe-right', label: 'Wipe Right', category: 'wipes' },
	{ type: 'wipe-up', label: 'Wipe Up', category: 'wipes' },
	{ type: 'wipe-down', label: 'Wipe Down', category: 'wipes' },
	{ type: 'wipe-circular', label: 'Circular Wipe', category: 'wipes' },
	{ type: 'wipe-diagonal', label: 'Diagonal Wipe', category: 'wipes' },
	{ type: 'iris', label: 'Iris', category: 'wipes' },
	// Slides
	{ type: 'slide-left', label: 'Slide Left', category: 'slides' },
	{ type: 'slide-right', label: 'Slide Right', category: 'slides' },
	{ type: 'push-left', label: 'Push Left', category: 'slides' },
	{ type: 'push-right', label: 'Push Right', category: 'slides' },
	{ type: 'push-up', label: 'Push Up', category: 'slides' },
	{ type: 'push-down', label: 'Push Down', category: 'slides' },
	// Zooms
	{ type: 'zoom-in', label: 'Zoom In', category: 'zooms' },
	{ type: 'zoom-out', label: 'Zoom Out', category: 'zooms' },
	// Creative
	{ type: 'blur', label: 'Blur', category: 'creative' },
	{ type: 'spin', label: 'Spin', category: 'creative' },
	{ type: 'glitch', label: 'Glitch', category: 'creative' },
	{ type: 'pixelate', label: 'Pixelate', category: 'creative' },
	{ type: 'blinds', label: 'Blinds', category: 'creative' },
	{ type: 'heart', label: 'Heart', category: 'creative' },
	{ type: 'fire', label: 'Fire', category: 'creative' },
	{ type: 'page-turn', label: 'Page Turn', category: 'creative' },
	{ type: 'morph', label: 'Morph', category: 'creative' },
];

export const TRANSITION_CATEGORIES: { id: TransitionCategory; label: string }[] = [
	{ id: 'fades', label: 'Fades' },
	{ id: 'wipes', label: 'Wipes' },
	{ id: 'slides', label: 'Slides' },
	{ id: 'zooms', label: 'Zooms' },
	{ id: 'creative', label: 'Creative' },
];
