import { describe, it, expect } from 'vitest';
import { requiredCredits, formatCredits, isFullyUnencumbered } from './attribution.js';
import type { AssetAttribution, MediaAsset } from '$lib/types/media.js';

function attribution(over: Partial<AssetAttribution> = {}): AssetAttribution {
	return {
		licence: 'by',
		licenceLabel: 'CC BY 4.0',
		licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
		creator: 'Someone',
		creatorUrl: null,
		sourceUrl: 'https://example.com/track',
		provider: 'freesound',
		required: true,
		text: '"Track" by Someone is licensed under CC BY 4.0.',
		...over,
	};
}

function asset(over: Partial<MediaAsset> = {}): MediaAsset {
	return {
		id: 'a1',
		name: 'track.mp3',
		file: new File([], 'track.mp3'),
		blobUrl: 'blob:x',
		type: 'audio',
		metadata: {
			duration: 10, width: 0, height: 0, fps: 0,
			codec: '', audioCodec: 'mp3', bitrate: 0, fileSize: 0, format: 'mp3',
		},
		thumbnails: [],
		waveform: null,
		addedAt: 0,
		...over,
	};
}

describe('requiredCredits', () => {
	it('is empty when nothing was imported from stock', () => {
		expect(requiredCredits([asset(), asset({ id: 'a2' })])).toEqual([]);
	});

	it('omits public-domain assets', () => {
		// Listing CC0 tracks would pad the list with non-obligations and train
		// people to ignore it.
		const cc0 = asset({ attribution: attribution({ required: false, licence: 'cc0' }) });
		expect(requiredCredits([cc0])).toEqual([]);
	});

	it('collects assets that do require credit', () => {
		const credited = asset({ attribution: attribution() });
		expect(requiredCredits([credited])).toHaveLength(1);
	});

	it('deduplicates the same track used twice', () => {
		const one = asset({ id: 'a1', attribution: attribution() });
		const two = asset({ id: 'a2', attribution: attribution() });
		expect(requiredCredits([one, two])).toHaveLength(1);
	});

	it('keeps genuinely different credits apart', () => {
		const one = asset({ id: 'a1', attribution: attribution({ text: 'First credit' }) });
		const two = asset({ id: 'a2', attribution: attribution({ text: 'Second credit' }) });
		expect(requiredCredits([one, two])).toHaveLength(2);
	});

	it('handles a mix', () => {
		const assets = [
			asset({ id: 'a1' }),
			asset({ id: 'a2', attribution: attribution({ required: false }) }),
			asset({ id: 'a3', attribution: attribution({ text: 'Needs credit' }) }),
		];
		expect(requiredCredits(assets).map((c) => c.text)).toEqual(['Needs credit']);
	});
});

describe('formatCredits', () => {
	it('is empty for nothing', () => {
		expect(formatCredits([])).toBe('');
	});

	it('renders a pasteable block', () => {
		const text = formatCredits([attribution({ text: 'A' }), attribution({ text: 'B' })]);
		expect(text).toBe('Credits\n\n• A\n• B');
	});
});

describe('isFullyUnencumbered', () => {
	it('is true for an all-CC0 project', () => {
		expect(isFullyUnencumbered([asset({ attribution: attribution({ required: false }) })])).toBe(true);
	});

	it('is false once one track needs credit', () => {
		expect(isFullyUnencumbered([asset({ attribution: attribution() })])).toBe(false);
	});
});
