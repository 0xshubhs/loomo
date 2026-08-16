/**
 * Music and sound effects from Openverse.
 *
 * Pexels — the project's other stock source — has no audio endpoint at all
 * (every `/audio` and `/music` path 404s), so this is a separate provider
 * rather than an extension of `stock-media.ts`. Openverse aggregates Freesound,
 * Jamendo and Wikimedia, needs no API key, and returns license metadata, which
 * is what makes it safe to use here.
 *
 * The licence filtering below is the important part. An unfiltered Openverse
 * search returns plenty of `by-nc-nd` and `by-nc` results, and neither can
 * lawfully go into an edited video: ND forbids derivative works and NC forbids
 * commercial use. Those are never requested.
 */

const OPENVERSE_BASE = 'https://api.openverse.org/v1';

/** Anonymous callers get 20 requests/minute and 200/day. */
export const RATE_LIMIT_NOTE = '20 searches per minute, 200 per day';

export type LicenceTier = 'cc0' | 'attribution';

/**
 * Licences requested for each tier.
 *
 * `cc0` and `pdm` are public-domain equivalents: usable commercially with no
 * credit. `by` requires a credit line but is otherwise unrestricted.
 *
 * `by-sa` is deliberately absent even though it permits commercial use — its
 * share-alike clause can arguably propagate to the finished video, which is
 * not a surprise to hand someone mid-edit.
 */
const TIER_LICENCES: Record<LicenceTier, string[]> = {
	cc0: ['cc0', 'pdm'],
	attribution: ['cc0', 'pdm', 'by'],
};

export interface AudioTrack {
	id: string;
	title: string;
	creator: string;
	creatorUrl: string | null;
	/** Direct media URL, usually an mp3 preview. */
	url: string;
	/** Openverse landing page, for a "view source" link. */
	landingUrl: string;
	/** Seconds. Openverse reports milliseconds. */
	duration: number;
	filetype: string;
	filesize: number;
	provider: string;
	licence: string;
	licenceVersion: string;
	licenceUrl: string;
	/** True when the licence obliges us to credit the creator. */
	requiresAttribution: boolean;
	/** Ready-made credit line supplied by Openverse. */
	attribution: string;
	tags: string[];
	waveformUrl: string | null;
}

export interface AudioSearchResult {
	tracks: AudioTrack[];
	/** Capped at 240 for anonymous callers. */
	totalCount: number;
	page: number;
	pageCount: number;
}

export class AudioLibraryError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
		this.name = 'AudioLibraryError';
	}
}

/** Licences that carry no attribution obligation. */
const PUBLIC_DOMAIN = new Set(['cc0', 'pdm']);

export function requiresAttribution(licence: string): boolean {
	return !PUBLIC_DOMAIN.has(licence.toLowerCase());
}

export function formatLicence(licence: string, version: string): string {
	const upper = licence.toUpperCase();
	if (upper === 'CC0') return 'CC0';
	if (upper === 'PDM') return 'Public Domain';
	return version ? `CC ${upper} ${version}` : `CC ${upper}`;
}

interface OpenverseAudio {
	id: string;
	title?: string;
	creator?: string;
	creator_url?: string;
	url?: string;
	foreign_landing_url?: string;
	duration?: number;
	filetype?: string;
	filesize?: number;
	provider?: string;
	license?: string;
	license_version?: string;
	license_url?: string;
	attribution?: string;
	tags?: { name: string }[];
	waveform?: string;
}

function toTrack(raw: OpenverseAudio): AudioTrack | null {
	// Some records are indexed without a playable URL; they are useless here.
	if (!raw.url || !raw.id) return null;

	const licence = (raw.license ?? '').toLowerCase();
	const title = raw.title?.trim() || 'Untitled';
	const creator = raw.creator?.trim() || 'Unknown';

	return {
		id: raw.id,
		title,
		creator,
		creatorUrl: raw.creator_url ?? null,
		url: raw.url,
		landingUrl: raw.foreign_landing_url ?? '',
		// Openverse reports milliseconds; the rest of the app works in seconds.
		duration: raw.duration ? raw.duration / 1000 : 0,
		filetype: raw.filetype ?? 'mp3',
		filesize: raw.filesize ?? 0,
		provider: raw.provider ?? 'openverse',
		licence,
		licenceVersion: raw.license_version ?? '',
		licenceUrl: raw.license_url ?? '',
		requiresAttribution: requiresAttribution(licence),
		attribution:
			raw.attribution?.trim() ||
			`"${title}" by ${creator}${licence ? ` (${formatLicence(licence, raw.license_version ?? '')})` : ''}`,
		tags: (raw.tags ?? []).map((t) => t.name).filter(Boolean).slice(0, 8),
		waveformUrl: raw.waveform ?? null,
	};
}

/**
 * Cache keyed by the full query.
 *
 * With only 200 anonymous requests a day, re-running a search the user already
 * made — paging back, or retyping the same word — must not spend quota.
 */
const cache = new Map<string, AudioSearchResult>();
const MAX_CACHE_ENTRIES = 80;

/** Remaining daily quota reported by the last response, when known. */
let remainingToday: number | null = null;

export function remainingSearches(): number | null {
	return remainingToday;
}

export interface AudioSearchOptions {
	query: string;
	tier?: LicenceTier;
	page?: number;
	/** Openverse caps anonymous callers at 20 per page. */
	pageSize?: number;
	signal?: AbortSignal;
}

export async function searchAudio(options: AudioSearchOptions): Promise<AudioSearchResult> {
	const { query, tier = 'cc0', page = 1, pageSize = 20, signal } = options;

	const params = new URLSearchParams({
		q: query.trim(),
		page: String(page),
		page_size: String(Math.min(pageSize, 20)),
		license: TIER_LICENCES[tier].join(','),
	});

	const key = params.toString();
	const cached = cache.get(key);
	if (cached) return cached;

	let response: Response;
	try {
		response = await fetch(`${OPENVERSE_BASE}/audio/?${params}`, {
			headers: { Accept: 'application/json' },
			signal,
		});
	} catch (error) {
		if ((error as Error).name === 'AbortError') throw error;
		throw new AudioLibraryError(0, 'Could not reach the audio library. Check your connection.');
	}

	const available = response.headers.get('x-ratelimit-available-anon_sustained');
	if (available !== null) remainingToday = Number(available);

	if (response.status === 429) {
		throw new AudioLibraryError(
			429,
			`Search limit reached — Openverse allows ${RATE_LIMIT_NOTE} without an account. Try again shortly.`
		);
	}
	if (!response.ok) {
		throw new AudioLibraryError(response.status, `Audio search failed (HTTP ${response.status}).`);
	}

	const body = await response.json();
	const result: AudioSearchResult = {
		tracks: ((body.results ?? []) as OpenverseAudio[])
			.map(toTrack)
			.filter((t): t is AudioTrack => t !== null),
		totalCount: body.result_count ?? 0,
		page,
		pageCount: body.page_count ?? 0,
	};

	if (cache.size >= MAX_CACHE_ENTRIES) {
		// Plain FIFO eviction; the map preserves insertion order.
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, result);

	return result;
}

/** Downloads a track so it can be imported like any other media file. */
export async function downloadTrack(track: AudioTrack): Promise<File> {
	const response = await fetch(track.url);
	if (!response.ok) {
		throw new AudioLibraryError(response.status, `Could not download "${track.title}".`);
	}
	const blob = await response.blob();
	const extension = track.filetype || 'mp3';
	const safeTitle = track.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'track';
	return new File([blob], `${safeTitle}.${extension}`, {
		type: blob.type || `audio/${extension}`,
	});
}

/** Search shortcuts, since Openverse's `category` filter is barely populated. */
export const AUDIO_PRESETS: { label: string; query: string; kind: 'music' | 'sfx' }[] = [
	{ label: 'Ambient', query: 'ambient atmosphere', kind: 'music' },
	{ label: 'Upbeat', query: 'upbeat energetic', kind: 'music' },
	{ label: 'Cinematic', query: 'cinematic orchestral', kind: 'music' },
	{ label: 'Lo-fi', query: 'lofi chill beat', kind: 'music' },
	{ label: 'Piano', query: 'piano solo', kind: 'music' },
	{ label: 'Percussion', query: 'drum percussion loop', kind: 'music' },
	{ label: 'Whoosh', query: 'whoosh transition swoosh', kind: 'sfx' },
	{ label: 'Click', query: 'click button ui', kind: 'sfx' },
	{ label: 'Impact', query: 'impact hit boom', kind: 'sfx' },
	{ label: 'Applause', query: 'applause crowd clap', kind: 'sfx' },
	{ label: 'Nature', query: 'birds wind rain nature', kind: 'sfx' },
	{ label: 'Notification', query: 'notification chime bell', kind: 'sfx' },
];
