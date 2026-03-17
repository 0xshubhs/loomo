const PEXELS_BASE = 'https://api.pexels.com';

const STORAGE_KEY = 'pexels_api_key';

export interface StockPhoto {
	id: number;
	url: string;
	photographer: string;
	photographer_url: string;
	src: { medium: string; large: string; original: string };
	width: number;
	height: number;
	alt: string;
}

export interface StockVideoFile {
	link: string;
	quality: string;
	width: number;
	height: number;
}

export interface StockVideo {
	id: number;
	url: string;
	user: { name: string; url: string };
	video_files: StockVideoFile[];
	image: string;
	duration: number;
	width: number;
	height: number;
}

export class StockMediaApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export function getApiKey(): string {
	if (typeof localStorage === 'undefined') return '';
	return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function setApiKey(key: string): void {
	if (typeof localStorage === 'undefined') return;
	if (key.trim()) {
		localStorage.setItem(STORAGE_KEY, key.trim());
	} else {
		localStorage.removeItem(STORAGE_KEY);
	}
}

async function pexelsFetch<T>(path: string): Promise<T> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new StockMediaApiError(401, 'Pexels API key is not configured');
	}

	const res = await fetch(`${PEXELS_BASE}${path}`, {
		headers: {
			Authorization: apiKey,
		},
	});

	if (res.status === 401) {
		throw new StockMediaApiError(401, 'Invalid Pexels API key');
	}

	if (res.status === 429) {
		throw new StockMediaApiError(429, 'Rate limit exceeded. Please wait a moment and try again.');
	}

	if (!res.ok) {
		throw new StockMediaApiError(res.status, `Pexels API error: ${res.statusText}`);
	}

	return res.json();
}

export async function searchPhotos(
	query: string,
	page = 1,
	perPage = 20
): Promise<{ photos: StockPhoto[]; total_results: number }> {
	const params = new URLSearchParams({
		query,
		page: String(page),
		per_page: String(perPage),
	});
	return pexelsFetch(`/v1/search?${params}`);
}

export async function searchVideos(
	query: string,
	page = 1,
	perPage = 20
): Promise<{ videos: StockVideo[]; total_results: number }> {
	const params = new URLSearchParams({
		query,
		page: String(page),
		per_page: String(perPage),
	});
	return pexelsFetch(`/videos/search?${params}`);
}

export async function getCuratedPhotos(
	page = 1,
	perPage = 20
): Promise<{ photos: StockPhoto[] }> {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage),
	});
	return pexelsFetch(`/v1/curated?${params}`);
}

export async function getPopularVideos(
	page = 1,
	perPage = 20
): Promise<{ videos: StockVideo[] }> {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage),
	});
	return pexelsFetch(`/videos/popular?${params}`);
}

/**
 * Download a stock media file with progress tracking.
 * Returns a File object ready to be imported.
 */
export async function downloadStockFile(
	url: string,
	filename: string,
	onProgress?: (progress: number) => void
): Promise<File> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to download: ${res.statusText}`);
	}

	const contentLength = res.headers.get('Content-Length');
	const total = contentLength ? parseInt(contentLength, 10) : 0;

	if (!res.body) {
		// Fallback if ReadableStream not available
		const blob = await res.blob();
		onProgress?.(1);
		return new File([blob], filename, { type: blob.type });
	}

	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		if (total > 0) {
			onProgress?.(received / total);
		} else {
			// Indeterminate - pulse between 0 and 0.9
			onProgress?.(Math.min(0.9, received / (received + 100000)));
		}
	}

	onProgress?.(1);
	const blob = new Blob(chunks as BlobPart[]);
	const type = res.headers.get('Content-Type') || 'application/octet-stream';
	return new File([blob], filename, { type });
}

/**
 * Pick the best video file: highest quality at or under 1080p.
 */
export function pickBestVideoFile(files: StockVideoFile[]): StockVideoFile | undefined {
	const eligible = files
		.filter((f) => f.height <= 1080 && f.link)
		.sort((a, b) => b.height - a.height || b.width - a.width);
	return eligible[0] ?? files[0];
}
