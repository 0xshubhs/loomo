import type { ClipFilters } from '$lib/types/timeline.js';
import { DEFAULT_CLIP_FILTERS } from '$lib/types/timeline.js';

export interface FilterPreset {
	name: string;
	label: string;
	color: string;
	overrides: Partial<ClipFilters>;
}

export const FILTER_PRESETS: FilterPreset[] = [
	{
		name: 'none',
		label: 'None',
		color: '#555555',
		overrides: {},
	},
	{
		name: 'warm',
		label: 'Warm',
		color: '#e8913a',
		overrides: { brightness: 105, saturation: 120, hue: 15 },
	},
	{
		name: 'cool',
		label: 'Cool',
		color: '#3a8ee8',
		overrides: { brightness: 100, saturation: 90, hue: 200 },
	},
	{
		name: 'vintage',
		label: 'Vintage',
		color: '#a08060',
		overrides: { brightness: 95, contrast: 120, saturation: 60 },
	},
	{
		name: 'dramatic',
		label: 'Dramatic',
		color: '#2a2a3a',
		overrides: { brightness: 90, contrast: 140, saturation: 80 },
	},
	{
		name: 'blackAndWhite',
		label: 'B&W',
		color: '#888888',
		overrides: { saturation: 0 },
	},
	{
		name: 'vivid',
		label: 'Vivid',
		color: '#e83a8e',
		overrides: { brightness: 105, contrast: 110, saturation: 150 },
	},
	{
		name: 'muted',
		label: 'Muted',
		color: '#8a9a7a',
		overrides: { brightness: 105, contrast: 90, saturation: 50 },
	},
	{
		name: 'sunset',
		label: 'Sunset',
		color: '#e8643a',
		overrides: { temperature: 40, saturation: 120, brightness: 105 },
	},
	{
		name: 'moonlight',
		label: 'Moonlight',
		color: '#4a5a8a',
		overrides: { temperature: -30, brightness: 85, saturation: 70 },
	},
	{
		name: 'golden',
		label: 'Golden',
		color: '#d4a840',
		overrides: { temperature: 25, exposure: 10, saturation: 110 },
	},
	{
		name: 'arctic',
		label: 'Arctic',
		color: '#8ac8e0',
		overrides: { temperature: -50, saturation: 60, brightness: 110 },
	},
];

/** Apply a preset's overrides on top of default filters. */
export function applyPreset(presetName: string): ClipFilters {
	const preset = FILTER_PRESETS.find((p) => p.name === presetName);
	if (!preset) return { ...DEFAULT_CLIP_FILTERS };
	return { ...DEFAULT_CLIP_FILTERS, ...preset.overrides };
}

/** Check if filters differ from defaults. */
export function hasNonDefaultFilters(filters: ClipFilters): boolean {
	return (
		filters.brightness !== DEFAULT_CLIP_FILTERS.brightness ||
		filters.contrast !== DEFAULT_CLIP_FILTERS.contrast ||
		filters.saturation !== DEFAULT_CLIP_FILTERS.saturation ||
		filters.hue !== DEFAULT_CLIP_FILTERS.hue ||
		filters.blur !== DEFAULT_CLIP_FILTERS.blur ||
		filters.opacity !== DEFAULT_CLIP_FILTERS.opacity ||
		filters.exposure !== DEFAULT_CLIP_FILTERS.exposure ||
		filters.temperature !== DEFAULT_CLIP_FILTERS.temperature
	);
}

/** Build a CSS filter string from clip filters. */
export function buildCssFilterString(filters: ClipFilters): string {
	const parts: string[] = [];
	// Base brightness includes exposure offset: exposure -100..100 maps to -0.5..0.5 brightness shift
	let brightnessValue = filters.brightness / 100;
	if (filters.exposure !== 0) {
		brightnessValue += filters.exposure / 200;
	}
	if (brightnessValue !== 1) parts.push(`brightness(${brightnessValue.toFixed(3)})`);
	if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast / 100})`);
	if (filters.saturation !== 100) parts.push(`saturate(${filters.saturation / 100})`);
	if (filters.hue !== 0) parts.push(`hue-rotate(${filters.hue}deg)`);
	if (filters.blur !== 0) parts.push(`blur(${filters.blur}px)`);
	if (filters.opacity !== 100) parts.push(`opacity(${filters.opacity / 100})`);
	// Temperature: warm (positive) uses sepia + hue-rotate, cool (negative) uses hue-rotate only
	if (filters.temperature !== 0) {
		const t = filters.temperature;
		if (t > 0) {
			// Warm: apply sepia proportional to temperature, then shift hue toward orange
			const sepiaAmount = Math.min(t / 100, 1);
			parts.push(`sepia(${sepiaAmount.toFixed(3)})`);
			parts.push(`hue-rotate(-${Math.round(t * 0.15)}deg)`);
		} else {
			// Cool: shift hue toward blue
			parts.push(`hue-rotate(${Math.round(Math.abs(t) * 1.8)}deg)`);
		}
	}
	return parts.join(' ') || 'none';
}
