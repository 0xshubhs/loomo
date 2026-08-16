import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	searchAudio,
	downloadTrack,
	requiresAttribution,
	formatLicence,
	AudioLibraryError,
	AUDIO_PRESETS,
	type AudioTrack,
} from './audio-library.js';

/** Minimal Openverse record; overrides let each test vary one thing. */
function record(over: Record<string, unknown> = {}) {
	return {
		id: 'abc-123',
		title: 'Test Track',
		creator: 'Someone',
		creator_url: 'https://example.com/someone',
		url: 'https://cdn.example.com/track.mp3',
		foreign_landing_url: 'https://example.com/track',
		duration: 69746,
		filetype: 'mp3',
		filesize: 1000,
		provider: 'freesound',
		license: 'cc0',
		license_version: '1.0',
		license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		attribution: '"Test Track" by Someone is marked with CC0 1.0.',
		tags: [{ name: 'ambient' }, { name: 'calm' }],
		waveform: 'https://api.openverse.org/v1/audio/abc-123/waveform/',
		...over,
	};
}

function respond(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
	return {
		ok: (init.status ?? 200) < 400,
		status: init.status ?? 200,
		headers: new Headers(init.headers ?? {}),
		json: async () => body,
	} as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Query string of the most recent request. */
function lastQuery(): URLSearchParams {
	const url = String(fetchMock.mock.calls.at(-1)![0]);
	return new URLSearchParams(url.split('?')[1]);
}

describe('licence filtering', () => {
	it('asks only for public-domain licences by default', async () => {
		fetchMock.mockResolvedValue(respond({ results: [], result_count: 0 }));
		await searchAudio({ query: 'cc0-default' });
		expect(lastQuery().get('license')).toBe('cc0,pdm');
	});

	it('adds CC BY on the attribution tier', async () => {
		fetchMock.mockResolvedValue(respond({ results: [], result_count: 0 }));
		await searchAudio({ query: 'attr-tier', tier: 'attribution' });
		expect(lastQuery().get('license')).toBe('cc0,pdm,by');
	});

	it('never requests a licence that forbids commercial use or derivatives', async () => {
		// An unfiltered Openverse search really does return by-nc-nd results,
		// and putting one in an edited video is a licence breach. No tier may
		// ever ask for nc, nd, or sa.
		fetchMock.mockResolvedValue(respond({ results: [], result_count: 0 }));

		for (const tier of ['cc0', 'attribution'] as const) {
			await searchAudio({ query: `forbidden-${tier}`, tier });
			const licences = lastQuery().get('license')!.split(',');
			for (const licence of licences) {
				expect(licence).not.toMatch(/nc/);
				expect(licence).not.toMatch(/nd/);
				expect(licence).not.toMatch(/sa/);
			}
		}
	});
});

describe('requiresAttribution', () => {
	it('is false for public-domain equivalents', () => {
		expect(requiresAttribution('cc0')).toBe(false);
		expect(requiresAttribution('pdm')).toBe(false);
		expect(requiresAttribution('CC0')).toBe(false);
	});

	it('is true for anything else', () => {
		expect(requiresAttribution('by')).toBe(true);
		expect(requiresAttribution('by-sa')).toBe(true);
	});
});

describe('formatLicence', () => {
	it('renders human labels', () => {
		expect(formatLicence('cc0', '1.0')).toBe('CC0');
		expect(formatLicence('pdm', '1.0')).toBe('Public Domain');
		expect(formatLicence('by', '4.0')).toBe('CC BY 4.0');
		expect(formatLicence('by', '')).toBe('CC BY');
	});
});

describe('result mapping', () => {
	it('converts milliseconds to seconds', async () => {
		fetchMock.mockResolvedValue(respond({ results: [record()], result_count: 1 }));
		const { tracks } = await searchAudio({ query: 'ms-to-s' });
		expect(tracks[0].duration).toBeCloseTo(69.746, 3);
	});

	it('marks a CC BY track as needing credit', async () => {
		fetchMock.mockResolvedValue(
			respond({ results: [record({ license: 'by', license_version: '4.0' })], result_count: 1 })
		);
		const { tracks } = await searchAudio({ query: 'by-track', tier: 'attribution' });
		expect(tracks[0].requiresAttribution).toBe(true);
	});

	it('marks a CC0 track as needing none', async () => {
		fetchMock.mockResolvedValue(respond({ results: [record()], result_count: 1 }));
		const { tracks } = await searchAudio({ query: 'cc0-track' });
		expect(tracks[0].requiresAttribution).toBe(false);
	});

	it('drops records with no playable url', async () => {
		fetchMock.mockResolvedValue(
			respond({ results: [record({ url: undefined }), record({ id: 'ok' })], result_count: 2 })
		);
		const { tracks } = await searchAudio({ query: 'no-url' });
		expect(tracks).toHaveLength(1);
		expect(tracks[0].id).toBe('ok');
	});

	it('falls back to a generated credit when the provider omits one', async () => {
		fetchMock.mockResolvedValue(
			respond({ results: [record({ attribution: undefined, license: 'by' })], result_count: 1 })
		);
		const { tracks } = await searchAudio({ query: 'no-attr', tier: 'attribution' });
		expect(tracks[0].attribution).toContain('Test Track');
		expect(tracks[0].attribution).toContain('Someone');
		expect(tracks[0].attribution).toContain('CC BY');
	});

	it('copes with missing optional fields', async () => {
		fetchMock.mockResolvedValue(
			respond({
				results: [{ id: 'x', url: 'https://cdn.example.com/a.mp3' }],
				result_count: 1,
			})
		);
		const { tracks } = await searchAudio({ query: 'sparse' });
		expect(tracks[0]).toMatchObject({ title: 'Untitled', creator: 'Unknown', duration: 0 });
	});
});

describe('quota handling', () => {
	it('reports the rate limit clearly instead of a bare 429', async () => {
		fetchMock.mockResolvedValue(respond({}, { status: 429 }));
		await expect(searchAudio({ query: 'rate-limited' })).rejects.toThrow(/limit reached/i);
	});

	it('surfaces a network failure as a readable message', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(searchAudio({ query: 'offline' })).rejects.toThrow(/Could not reach/i);
	});

	it('propagates an abort rather than mislabelling it', async () => {
		const abort = new Error('aborted');
		abort.name = 'AbortError';
		fetchMock.mockRejectedValue(abort);
		await expect(searchAudio({ query: 'aborted' })).rejects.toThrow('aborted');
	});

	it('throws AudioLibraryError with the status attached', async () => {
		fetchMock.mockResolvedValue(respond({}, { status: 503 }));
		await expect(searchAudio({ query: 'down' })).rejects.toBeInstanceOf(AudioLibraryError);
	});
});

describe('caching', () => {
	it('serves a repeated search without spending quota', async () => {
		// Only 200 anonymous searches a day, so paging back to a previous
		// query must not cost another request.
		fetchMock.mockResolvedValue(respond({ results: [record()], result_count: 1 }));

		await searchAudio({ query: 'cache-me' });
		await searchAudio({ query: 'cache-me' });

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('treats a different page as a different search', async () => {
		fetchMock.mockResolvedValue(respond({ results: [record()], result_count: 1 }));
		await searchAudio({ query: 'paged' });
		await searchAudio({ query: 'paged', page: 2 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('treats a different tier as a different search', async () => {
		fetchMock.mockResolvedValue(respond({ results: [record()], result_count: 1 }));
		await searchAudio({ query: 'tiered' });
		await searchAudio({ query: 'tiered', tier: 'attribution' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('pagination', () => {
	it('never exceeds the anonymous page-size cap', async () => {
		// Openverse answers 401 for page_size above 20 without a key.
		fetchMock.mockResolvedValue(respond({ results: [], result_count: 0 }));
		await searchAudio({ query: 'big-page', pageSize: 100 });
		expect(lastQuery().get('page_size')).toBe('20');
	});
});

describe('downloadTrack', () => {
	const track: AudioTrack = {
		id: 'a', title: 'My Track!! <weird>', creator: 'X', creatorUrl: null,
		url: 'https://cdn.example.com/a.mp3', landingUrl: '', duration: 1,
		filetype: 'mp3', filesize: 1, provider: 'freesound', licence: 'cc0',
		licenceVersion: '1.0', licenceUrl: '', requiresAttribution: false,
		attribution: '', tags: [], waveformUrl: null,
	};

	it('names the file safely', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			blob: async () => new Blob(['x'], { type: 'audio/mpeg' }),
		} as unknown as Response);

		const file = await downloadTrack(track);
		expect(file.name).toBe('My Track weird.mp3');
	});

	it('reports a failed download', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
		await expect(downloadTrack(track)).rejects.toThrow(/Could not download/);
	});
});

describe('presets', () => {
	it('offers both music and sound effects', () => {
		expect(AUDIO_PRESETS.some((p) => p.kind === 'music')).toBe(true);
		expect(AUDIO_PRESETS.some((p) => p.kind === 'sfx')).toBe(true);
	});
});
