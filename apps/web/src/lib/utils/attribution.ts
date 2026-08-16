import type { AssetAttribution, MediaAsset } from '$lib/types/media.js';

/**
 * Collects the credits a project owes.
 *
 * Only assets whose licence actually requires a credit are listed — padding
 * the list with CC0 tracks would train people to ignore it, and the whole
 * point is that the entries which remain are obligations.
 */
export function requiredCredits(assets: MediaAsset[]): AssetAttribution[] {
	const seen = new Set<string>();
	const credits: AssetAttribution[] = [];

	for (const asset of assets) {
		const attribution = asset.attribution;
		if (!attribution?.required) continue;
		// The same track dropped on the timeline twice is one credit.
		const key = attribution.text;
		if (seen.has(key)) continue;
		seen.add(key);
		credits.push(attribution);
	}

	return credits;
}

/** Plain-text credits block, for a description box or the end of a video. */
export function formatCredits(credits: AssetAttribution[]): string {
	if (credits.length === 0) return '';
	return ['Credits', '', ...credits.map((c) => `• ${c.text}`)].join('\n');
}

/** True when the project can be published with no credit line at all. */
export function isFullyUnencumbered(assets: MediaAsset[]): boolean {
	return requiredCredits(assets).length === 0;
}
