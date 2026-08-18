/**
 * Fetching model weights once and keeping them.
 *
 * Nothing here touches ONNX. It downloads bytes with progress, checks them
 * against the digest in the registry, and stores them so the second run is
 * instant. All of it is injectable — `fetch` and the storage backend are both
 * parameters — so the tests exercise the real code paths with no network.
 */

import type { ModelSpec } from './model-registry.js';

export interface DownloadProgress {
	readonly received: number;
	/** Null when the server sends no content-length. */
	readonly total: number | null;
	/** Null for the same reason — an unknown total has no meaningful fraction. */
	readonly fraction: number | null;
}

export class ModelDownloadError extends Error {
	/** True when the caller aborted, which the UI should not report as failure. */
	readonly cancelled: boolean;

	constructor(message: string, options?: { cancelled?: boolean; cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = 'ModelDownloadError';
		this.cancelled = options?.cancelled ?? false;
	}
}

export class ModelIntegrityError extends Error {
	constructor(
		readonly modelId: string,
		readonly expected: string,
		readonly actual: string
	) {
		super(
			`Model "${modelId}" failed its integrity check. Expected ${expected}, got ${actual}. The download was discarded.`
		);
		this.name = 'ModelIntegrityError';
	}
}

/** Where downloaded weights live. Swapped for an in-memory map under test. */
export interface ModelStore {
	get(id: string): Promise<Uint8Array | null>;
	put(id: string, bytes: Uint8Array): Promise<void>;
	has(id: string): Promise<boolean>;
	delete(id: string): Promise<void>;
	list(): Promise<string[]>;
}

export class MemoryModelStore implements ModelStore {
	private entries = new Map<string, Uint8Array>();

	async get(id: string): Promise<Uint8Array | null> {
		return this.entries.get(id) ?? null;
	}

	async put(id: string, bytes: Uint8Array): Promise<void> {
		this.entries.set(id, bytes);
	}

	async has(id: string): Promise<boolean> {
		return this.entries.has(id);
	}

	async delete(id: string): Promise<void> {
		this.entries.delete(id);
	}

	async list(): Promise<string[]> {
		return [...this.entries.keys()];
	}
}

const CACHE_NAME = 'loomo-ai-models-v1';

/**
 * TypeScript types a bare `Uint8Array` as possibly SharedArrayBuffer-backed,
 * which `BufferSource` and `BlobPart` refuse. Every array in this module comes
 * from a plain ArrayBuffer, so the widening is safe and keeps the alternative
 * — copying hundreds of megabytes to satisfy the checker — off the table.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
	return bytes as unknown as BufferSource;
}

/**
 * The browser Cache API, used as a large binary store.
 *
 * Chosen over IndexedDB because these are single immutable blobs of up to a
 * few hundred megabytes: the Cache API streams them without ever holding two
 * copies, and the eviction story matches what these are — a cache. Keys are
 * synthetic same-origin URLs, since Cache demands a Request.
 */
export class CacheStorageModelStore implements ModelStore {
	private keyFor(id: string): string {
		return `/__loomo-ai-model__/${encodeURIComponent(id)}`;
	}

	private open(): Promise<Cache> {
		return caches.open(CACHE_NAME);
	}

	async get(id: string): Promise<Uint8Array | null> {
		const cache = await this.open();
		const hit = await cache.match(this.keyFor(id));
		if (!hit) return null;
		return new Uint8Array(await hit.arrayBuffer());
	}

	async put(id: string, bytes: Uint8Array): Promise<void> {
		const cache = await this.open();
		const body = new Blob([asBufferSource(bytes)], { type: 'application/octet-stream' });
		await cache.put(this.keyFor(id), new Response(body));
	}

	async has(id: string): Promise<boolean> {
		const cache = await this.open();
		return (await cache.match(this.keyFor(id))) !== undefined;
	}

	async delete(id: string): Promise<void> {
		const cache = await this.open();
		await cache.delete(this.keyFor(id));
	}

	async list(): Promise<string[]> {
		const cache = await this.open();
		const requests = await cache.keys();
		const prefix = '/__loomo-ai-model__/';
		return requests
			.map((request) => new URL(request.url).pathname)
			.filter((path) => path.startsWith(prefix))
			.map((path) => decodeURIComponent(path.slice(prefix.length)));
	}
}

/**
 * Picks a store that works here. Falls back to memory during SSR and in
 * private-browsing modes where CacheStorage is missing — the tools still run,
 * they just re-download on the next reload.
 */
export function createModelStore(): ModelStore {
	if (typeof caches === 'undefined') return new MemoryModelStore();
	return new CacheStorageModelStore();
}

/** Lowercase hex SHA-256. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new ModelDownloadError(
			'Cannot verify the model: WebCrypto is unavailable (this usually means an insecure origin).'
		);
	}
	const digest = await subtle.digest('SHA-256', asBufferSource(bytes));
	let out = '';
	for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, '0');
	return out;
}

export interface DownloadOptions {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Fetches a URL, reporting progress as the body streams in.
 *
 * Falls back to a single `arrayBuffer()` read when the response has no
 * readable body — some proxies and every mocked Response behave that way — so
 * the only thing lost is the progress bar, not the download.
 */
export async function downloadWithProgress(
	url: string,
	options: DownloadOptions = {}
): Promise<Uint8Array> {
	const { fetchImpl = globalThis.fetch, signal, onProgress } = options;
	if (typeof fetchImpl !== 'function') {
		throw new ModelDownloadError('No fetch implementation is available to download models.');
	}

	let response: Response;
	try {
		response = await fetchImpl(url, { signal });
	} catch (error) {
		if (signal?.aborted) throw new ModelDownloadError('Download cancelled.', { cancelled: true });
		throw new ModelDownloadError(
			'Could not reach the model host. Check your connection and try again.',
			{ cause: error }
		);
	}

	if (!response.ok) {
		throw new ModelDownloadError(
			`The model host returned ${response.status} ${response.statusText || ''}`.trim()
		);
	}

	const header = response.headers?.get?.('content-length');
	const parsed = header === null || header === undefined ? NaN : Number(header);
	const total = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

	const body = response.body;
	if (!body) {
		const buffer = new Uint8Array(await response.arrayBuffer());
		onProgress?.({ received: buffer.length, total: total ?? buffer.length, fraction: 1 });
		return buffer;
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;

	try {
		for (;;) {
			if (signal?.aborted) {
				await reader.cancel();
				throw new ModelDownloadError('Download cancelled.', { cancelled: true });
			}
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			chunks.push(value);
			received += value.length;
			onProgress?.({
				received,
				total,
				// A total larger than what arrives would push this past 1, which
				// would look like a broken progress bar.
				fraction: total ? Math.min(1, received / total) : null,
			});
		}
	} catch (error) {
		if (error instanceof ModelDownloadError) throw error;
		if (signal?.aborted) throw new ModelDownloadError('Download cancelled.', { cancelled: true });
		throw new ModelDownloadError('The model download was interrupted.', { cause: error });
	}

	const out = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}

	// A final tick guarantees the bar reaches 100% even when content-length
	// under-reported or the body arrived in one chunk.
	onProgress?.({ received, total: total ?? received, fraction: 1 });
	return out;
}

export interface CachedModel {
	readonly bytes: Uint8Array;
	/** True when nothing was downloaded. */
	readonly fromCache: boolean;
	/** False when the registry has no pinned digest for this model. */
	readonly verified: boolean;
}

export interface EnsureOptions {
	signal?: AbortSignal;
	onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Checks bytes against a spec's digest.
 *
 * Returns false rather than throwing when the spec has no digest, so callers
 * can distinguish "not verified" from "verified and wrong" — the second is a
 * hard error, the first is a caveat to display.
 */
export async function verifyModelBytes(bytes: Uint8Array, spec: ModelSpec): Promise<boolean> {
	if (!spec.sha256) return false;
	const actual = await sha256Hex(bytes);
	if (actual !== spec.sha256.toLowerCase()) {
		throw new ModelIntegrityError(spec.id, spec.sha256.toLowerCase(), actual);
	}
	return true;
}

export class ModelCache {
	private readonly store: ModelStore;
	private readonly fetchImpl: typeof fetch | undefined;
	/**
	 * Two tools sharing a model must not start two 176 MB downloads, so
	 * in-flight work is shared by id.
	 */
	private inflight = new Map<string, Promise<CachedModel>>();

	constructor(options: { store?: ModelStore; fetchImpl?: typeof fetch } = {}) {
		this.store = options.store ?? createModelStore();
		this.fetchImpl = options.fetchImpl;
	}

	/** Whether the weights are already on disk, so the UI can skip the prompt. */
	async isCached(spec: ModelSpec | string): Promise<boolean> {
		const id = typeof spec === 'string' ? spec : spec.id;
		try {
			return await this.store.has(id);
		} catch {
			// A storage backend that throws (quota, private mode) means "not
			// cached" as far as anyone calling this cares.
			return false;
		}
	}

	async cachedIds(): Promise<string[]> {
		try {
			return await this.store.list();
		} catch {
			return [];
		}
	}

	async evict(spec: ModelSpec | string): Promise<void> {
		const id = typeof spec === 'string' ? spec : spec.id;
		await this.store.delete(id);
	}

	/**
	 * Returns the model's bytes, downloading them if this is the first time.
	 *
	 * `signal` only cancels a download this call started; a caller that joined
	 * someone else's in-flight download cannot cancel it out from under them.
	 */
	async ensure(spec: ModelSpec, options: EnsureOptions = {}): Promise<CachedModel> {
		const existing = this.inflight.get(spec.id);
		if (existing) return existing;

		const work = this.load(spec, options).finally(() => {
			this.inflight.delete(spec.id);
		});
		this.inflight.set(spec.id, work);
		return work;
	}

	private async load(spec: ModelSpec, options: EnsureOptions): Promise<CachedModel> {
		const cached = await this.store.get(spec.id).catch(() => null);
		if (cached && cached.length > 0) {
			// Deliberately not re-hashed: digesting 176 MB costs about as much as
			// the inference itself, and the bytes were verified when they were
			// written. Corruption inside the browser's own cache is not the
			// threat model here.
			options.onProgress?.({ received: cached.length, total: cached.length, fraction: 1 });
			return { bytes: cached, fromCache: true, verified: spec.sha256 !== null };
		}

		const bytes = await downloadWithProgress(spec.url, {
			fetchImpl: this.fetchImpl,
			signal: options.signal,
			onProgress: options.onProgress,
		});

		// Verify before storing, so a bad download is never cached and retried
		// forever out of the cache.
		const verified = await verifyModelBytes(bytes, spec);

		try {
			await this.store.put(spec.id, bytes);
		} catch (error) {
			// Out of quota is annoying, not fatal — the model is in memory and
			// this run can still proceed.
			console.warn(`[ai] could not cache model "${spec.id}"; it will re-download later`, error);
		}

		return { bytes, fromCache: false, verified };
	}
}
