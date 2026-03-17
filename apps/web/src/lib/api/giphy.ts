const GIPHY_API_KEY = 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65'; // Public beta key

interface GiphyImage {
	url: string;
	width: string;
	height: string;
}

interface GiphyGif {
	id: string;
	title: string;
	images: {
		fixed_height: GiphyImage;
		fixed_height_small: GiphyImage;
		original: GiphyImage;
		downsized: GiphyImage;
	};
}

interface GiphyResponse {
	data: GiphyGif[];
	pagination: {
		total_count: number;
		count: number;
		offset: number;
	};
}

export interface GiphyResult {
	id: string;
	title: string;
	previewUrl: string;
	fullUrl: string;
	width: number;
	height: number;
}

function mapGif(gif: GiphyGif): GiphyResult {
	return {
		id: gif.id,
		title: gif.title,
		previewUrl: gif.images.fixed_height_small.url,
		fullUrl: gif.images.original.url,
		width: parseInt(gif.images.original.width) || 480,
		height: parseInt(gif.images.original.height) || 480,
	};
}

export async function searchGifs(query: string, offset = 0, limit = 20): Promise<{ results: GiphyResult[]; total: number }> {
	const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&rating=g&lang=en`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GIPHY API error: ${res.status}`);
	const data: GiphyResponse = await res.json();
	return {
		results: data.data.map(mapGif),
		total: data.pagination.total_count,
	};
}

export async function trendingGifs(offset = 0, limit = 20): Promise<{ results: GiphyResult[]; total: number }> {
	const url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&offset=${offset}&rating=g`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GIPHY API error: ${res.status}`);
	const data: GiphyResponse = await res.json();
	return {
		results: data.data.map(mapGif),
		total: data.pagination.total_count,
	};
}

export async function searchStickers(query: string, offset = 0, limit = 20): Promise<{ results: GiphyResult[]; total: number }> {
	const url = `https://api.giphy.com/v1/stickers/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&rating=g&lang=en`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GIPHY API error: ${res.status}`);
	const data: GiphyResponse = await res.json();
	return {
		results: data.data.map(mapGif),
		total: data.pagination.total_count,
	};
}

export async function trendingStickers(offset = 0, limit = 20): Promise<{ results: GiphyResult[]; total: number }> {
	const url = `https://api.giphy.com/v1/stickers/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&offset=${offset}&rating=g`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GIPHY API error: ${res.status}`);
	const data: GiphyResponse = await res.json();
	return {
		results: data.data.map(mapGif),
		total: data.pagination.total_count,
	};
}

/** Download a GIF as a File object for import into the media library. */
export async function downloadGif(gif: GiphyResult): Promise<File> {
	const res = await fetch(gif.fullUrl);
	const blob = await res.blob();
	const filename = `${gif.title || 'giphy'}.gif`.replace(/[^a-zA-Z0-9._-]/g, '_');
	return new File([blob], filename, { type: 'image/gif' });
}
