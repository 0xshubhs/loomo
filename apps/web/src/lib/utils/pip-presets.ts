import type { ClipPosition } from '$lib/types/timeline.js';

export interface PipPreset {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export const PIP_PRESETS: PipPreset[] = [
	{ id: 'fullscreen', label: 'Full Screen', x: 0, y: 0, width: 100, height: 100 },
	{ id: 'top-left', label: 'Top Left', x: 5, y: 5, width: 30, height: 30 },
	{ id: 'top-right', label: 'Top Right', x: 65, y: 5, width: 30, height: 30 },
	{ id: 'bottom-left', label: 'Bottom Left', x: 5, y: 65, width: 30, height: 30 },
	{ id: 'bottom-right', label: 'Bottom Right', x: 65, y: 65, width: 30, height: 30 },
	{ id: 'center-small', label: 'Center Small', x: 30, y: 30, width: 40, height: 40 },
	{ id: 'left-half', label: 'Left Half', x: 0, y: 0, width: 50, height: 100 },
	{ id: 'right-half', label: 'Right Half', x: 50, y: 0, width: 50, height: 100 },
	{ id: 'top-half', label: 'Top Half', x: 0, y: 0, width: 100, height: 50 },
	{ id: 'bottom-half', label: 'Bottom Half', x: 0, y: 50, width: 100, height: 50 },
];

export function presetToPosition(preset: PipPreset, zIndex: number = 0): ClipPosition {
	return {
		x: preset.x,
		y: preset.y,
		width: preset.width,
		height: preset.height,
		zIndex,
	};
}

export function hasNonDefaultPosition(pos: ClipPosition): boolean {
	return pos.x !== 0 || pos.y !== 0 || pos.width !== 100 || pos.height !== 100 || pos.zIndex !== 0;
}
