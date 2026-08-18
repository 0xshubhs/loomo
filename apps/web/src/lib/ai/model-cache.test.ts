import { describe, it, expect, vi } from 'vitest';
import {
	downloadWithProgress,
	MemoryModelStore,
	ModelCache,
	ModelDownloadError,
	ModelIntegrityError,
	sha256Hex,
	verifyModelBytes,
	type DownloadProgress,
} from './model-cache.js';
import type { ModelSpec } from './model-registry.js';

/** A spec is just data here — no need to depend on a real registered model. */
function makeSpec(overrides: Partial<ModelSpec> = {}): ModelSpec {
	return {
		id: 'test-model',
		name: 'Test Model',
		purpose: 'background-removal',
		url: 'https://models.invalid/test.onnx',
		sha256: null,
		bytes: 6,
		licence: 'MIT',
		licenceUrl: 'https://example.invalid/licence',
		commercialUse: true,
		input: { name: 'input', width: 4, height: 4, channels: 3 },
		output: { name: 'output', width: 4, height: 4, channels: 1 },
		mean: [0, 0, 0],
		std: [1, 1, 1],
		scale: 1,
		wasmFrameMs: 10,
		recommended: true,
		summary: 'test',
		...overrides,
	};
}

/** Builds a Response whose body streams in the given chunks. */
function streamingResponse(chunks: Uint8Array[], init: { contentLength?: number | null } = {}) {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
	const headers = new Headers();
	if (init.contentLength !== null) {
		const total = init.contentLength ?? chunks.reduce((sum, c) => sum + c.length, 0);
		headers.set('content-length', String(total));
	}
	return new Response(body, { status: 200, headers });
}

describe('sha256Hex', () => {
	it('should match the published digest for "abc"', async () => {
		const bytes = new TextEncoder().encode('abc');
		expect(await sha256Hex(bytes)).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('should match the published digest for the empty input', async () => {
		expect(await sha256Hex(new Uint8Array(0))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
		);
	});

	it('should produce 64 lowercase hex characters', async () => {
		expect(await sha256Hex(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('downloadWithProgress', () => {
	it('should concatenate streamed chunks in order', async () => {
		const fetchImpl = vi.fn(async () =>
			streamingResponse([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])])
		);
		const bytes = await downloadWithProgress('https://models.invalid/m.onnx', {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
	});

	it('should report monotonic progress that ends at 1', async () => {
		const seen: DownloadProgress[] = [];
		const fetchImpl = vi.fn(async () =>
			streamingResponse([new Uint8Array(4), new Uint8Array(4), new Uint8Array(2)])
		);

		await downloadWithProgress('https://models.invalid/m.onnx', {
			fetchImpl: fetchImpl as unknown as typeof fetch,
			onProgress: (progress) => seen.push(progress),
		});

		expect(seen.length).toBeGreaterThanOrEqual(3);
		expect(seen.map((p) => p.received)).toEqual([...seen.map((p) => p.received)].sort((a, b) => a - b));
		expect(seen[seen.length - 1].fraction).toBe(1);
		expect(seen[seen.length - 1].received).toBe(10);
	});

	it('should report a null total and fraction when content-length is missing', async () => {
		const seen: DownloadProgress[] = [];
		const fetchImpl = vi.fn(async () =>
			streamingResponse([new Uint8Array(3)], { contentLength: null })
		);

		await downloadWithProgress('https://models.invalid/m.onnx', {
			fetchImpl: fetchImpl as unknown as typeof fetch,
			onProgress: (progress) => seen.push(progress),
		});

		expect(seen[0].total).toBeNull();
		expect(seen[0].fraction).toBeNull();
	});

	it('should never report a fraction above 1 when content-length under-reports', async () => {
		const seen: DownloadProgress[] = [];
		const fetchImpl = vi.fn(async () =>
			streamingResponse([new Uint8Array(10)], { contentLength: 4 })
		);

		await downloadWithProgress('https://models.invalid/m.onnx', {
			fetchImpl: fetchImpl as unknown as typeof fetch,
			onProgress: (progress) => seen.push(progress),
		});

		for (const progress of seen) expect(progress.fraction).toBeLessThanOrEqual(1);
	});

	it('should fall back to arrayBuffer when the response has no body', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			headers: new Headers({ 'content-length': '3' }),
			body: null,
			arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
		}));

		const bytes = await downloadWithProgress('https://models.invalid/m.onnx', {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect([...bytes]).toEqual([9, 8, 7]);
	});

	it('should throw a ModelDownloadError on a non-ok response', async () => {
		const fetchImpl = vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' }));
		await expect(
			downloadWithProgress('https://models.invalid/m.onnx', {
				fetchImpl: fetchImpl as unknown as typeof fetch,
			})
		).rejects.toThrow(ModelDownloadError);
	});

	it('should surface a network failure as a readable message, not a raw TypeError', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		await expect(
			downloadWithProgress('https://models.invalid/m.onnx', {
				fetchImpl: fetchImpl as unknown as typeof fetch,
			})
		).rejects.toThrow(/Could not reach the model host/);
	});

	it('should report cancellation separately from failure', async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchImpl = vi.fn(async () => {
			throw new DOMException('Aborted', 'AbortError');
		});

		const error = await downloadWithProgress('https://models.invalid/m.onnx', {
			fetchImpl: fetchImpl as unknown as typeof fetch,
			signal: controller.signal,
		}).catch((e) => e);

		expect(error).toBeInstanceOf(ModelDownloadError);
		expect((error as ModelDownloadError).cancelled).toBe(true);
	});

	it('should explain itself when no fetch implementation exists', async () => {
		await expect(
			// null rather than undefined, so the parameter default does not fill in
			// Node's own fetch and hide the branch under test.
			downloadWithProgress('https://models.invalid/m.onnx', {
				fetchImpl: null as unknown as typeof fetch,
			})
		).rejects.toThrow(/No fetch implementation/);
	});
});

describe('verifyModelBytes', () => {
	it('should return false when the spec has no pinned digest', async () => {
		expect(await verifyModelBytes(new Uint8Array([1]), makeSpec({ sha256: null }))).toBe(false);
	});

	it('should return true when the digest matches', async () => {
		const bytes = new TextEncoder().encode('abc');
		const spec = makeSpec({
			sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		});
		expect(await verifyModelBytes(bytes, spec)).toBe(true);
	});

	it('should throw ModelIntegrityError when the digest does not match', async () => {
		const spec = makeSpec({ sha256: 'a'.repeat(64) });
		await expect(verifyModelBytes(new TextEncoder().encode('abc'), spec)).rejects.toThrow(
			ModelIntegrityError
		);
	});
});

describe('MemoryModelStore', () => {
	it('should round-trip bytes', async () => {
		const store = new MemoryModelStore();
		await store.put('a', new Uint8Array([1, 2]));
		expect([...(await store.get('a'))!]).toEqual([1, 2]);
		expect(await store.has('a')).toBe(true);
		expect(await store.list()).toEqual(['a']);
	});

	it('should report a miss as null', async () => {
		expect(await new MemoryModelStore().get('missing')).toBeNull();
	});

	it('should delete', async () => {
		const store = new MemoryModelStore();
		await store.put('a', new Uint8Array([1]));
		await store.delete('a');
		expect(await store.has('a')).toBe(false);
	});
});

describe('ModelCache', () => {
	it('should download on a miss and serve the second call from cache', async () => {
		const store = new MemoryModelStore();
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([1, 2, 3])]));
		const cache = new ModelCache({ store, fetchImpl: fetchImpl as unknown as typeof fetch });
		const spec = makeSpec();

		const first = await cache.ensure(spec);
		expect(first.fromCache).toBe(false);
		expect([...first.bytes]).toEqual([1, 2, 3]);

		const second = await cache.ensure(spec);
		expect(second.fromCache).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('should report isCached before and after a download', async () => {
		const store = new MemoryModelStore();
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([1])]));
		const cache = new ModelCache({ store, fetchImpl: fetchImpl as unknown as typeof fetch });
		const spec = makeSpec();

		expect(await cache.isCached(spec)).toBe(false);
		await cache.ensure(spec);
		expect(await cache.isCached(spec)).toBe(true);
	});

	it('should mark a download unverified when the spec has no digest', async () => {
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([1])]));
		const cache = new ModelCache({
			store: new MemoryModelStore(),
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect((await cache.ensure(makeSpec({ sha256: null }))).verified).toBe(false);
	});

	it('should mark a download verified when the digest matches', async () => {
		const bytes = new TextEncoder().encode('abc');
		const fetchImpl = vi.fn(async () => streamingResponse([bytes]));
		const cache = new ModelCache({
			store: new MemoryModelStore(),
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const spec = makeSpec({
			sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		});
		expect((await cache.ensure(spec)).verified).toBe(true);
	});

	it('should not cache bytes that fail the integrity check', async () => {
		const store = new MemoryModelStore();
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([1, 2, 3])]));
		const cache = new ModelCache({ store, fetchImpl: fetchImpl as unknown as typeof fetch });
		const spec = makeSpec({ sha256: 'b'.repeat(64) });

		await expect(cache.ensure(spec)).rejects.toThrow(ModelIntegrityError);
		expect(await store.has(spec.id)).toBe(false);
	});

	it('should share one download between concurrent callers', async () => {
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([7])]));
		const cache = new ModelCache({
			store: new MemoryModelStore(),
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const spec = makeSpec();

		const [a, b] = await Promise.all([cache.ensure(spec), cache.ensure(spec)]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect([...a.bytes]).toEqual([7]);
		expect([...b.bytes]).toEqual([7]);
	});

	it('should allow a retry after a failed download', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('offline'))
			.mockResolvedValueOnce(streamingResponse([new Uint8Array([5])]));
		const cache = new ModelCache({
			store: new MemoryModelStore(),
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const spec = makeSpec();

		await expect(cache.ensure(spec)).rejects.toThrow(ModelDownloadError);
		expect([...(await cache.ensure(spec)).bytes]).toEqual([5]);
	});

	it('should still return the bytes when the store cannot save them', async () => {
		const store = new MemoryModelStore();
		store.put = async () => {
			throw new Error('QuotaExceededError');
		};
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([4])]));
		const cache = new ModelCache({ store, fetchImpl: fetchImpl as unknown as typeof fetch });

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect([...(await cache.ensure(makeSpec())).bytes]).toEqual([4]);
		warn.mockRestore();
	});

	it('should treat a throwing store as a cache miss rather than crashing', async () => {
		const store = new MemoryModelStore();
		store.has = async () => {
			throw new Error('private mode');
		};
		const cache = new ModelCache({ store });
		expect(await cache.isCached(makeSpec())).toBe(false);
	});

	it('should evict a cached model', async () => {
		const store = new MemoryModelStore();
		const fetchImpl = vi.fn(async () => streamingResponse([new Uint8Array([1])]));
		const cache = new ModelCache({ store, fetchImpl: fetchImpl as unknown as typeof fetch });
		const spec = makeSpec();

		await cache.ensure(spec);
		await cache.evict(spec);
		expect(await cache.isCached(spec)).toBe(false);
		expect(await cache.cachedIds()).toEqual([]);
	});
});
