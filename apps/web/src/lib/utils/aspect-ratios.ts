export const ASPECT_RATIOS = [
	{ label: '16:9', width: 1920, height: 1080, description: 'YouTube, Landscape' },
	{ label: '9:16', width: 1080, height: 1920, description: 'TikTok, Reels, Shorts' },
	{ label: '1:1', width: 1080, height: 1080, description: 'Instagram Post' },
	{ label: '4:5', width: 1080, height: 1350, description: 'Instagram Portrait' },
	{ label: '4:3', width: 1440, height: 1080, description: 'Classic' },
	{ label: '21:9', width: 2560, height: 1080, description: 'Ultrawide, Cinematic' },
] as const;

export type AspectRatioPreset = (typeof ASPECT_RATIOS)[number];

export const DEFAULT_ASPECT_RATIO = ASPECT_RATIOS[0];

/**
 * Scale a base aspect ratio to a target resolution tier.
 * Keeps the aspect ratio but adjusts the pixel dimensions.
 */
export function scaleToResolution(
	aspectLabel: string,
	tier: '4k' | '1080p' | '720p' | '480p'
): { width: number; height: number } {
	const preset = ASPECT_RATIOS.find((r) => r.label === aspectLabel) ?? ASPECT_RATIOS[0];
	const ratio = preset.width / preset.height;

	const baseHeights: Record<string, number> = {
		'4k': 2160,
		'1080p': 1080,
		'720p': 720,
		'480p': 480,
	};

	const height = baseHeights[tier] ?? 1080;
	// Ensure width is even (required by most codecs)
	const width = Math.round((height * ratio) / 2) * 2;

	return { width, height };
}
