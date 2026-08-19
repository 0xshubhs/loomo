import { describe, it, expect, vi } from 'vitest';
import { OverlayFrameCache, type OverlayFrameRequest } from './overlay-frames.js';
import { createClip } from '$lib/types/timeline.js';

/**
 * Overlay layers need a picture without a decoder each. Decoding is async and
 * drawing is not, so the rule is: hand back the best frame available now, and
 * never stall the preview waiting for a better one.
 */

function bitmap(): ImageBitmap {
	return { close: vi.fn(), width: 10, height: 10 } as unknown as ImageBitmap;
}

function request(over: Partial<OverlayFrameRequest> = {}): OverlayFrameRequest {
	return {
		clip: createClip({
			id: 'c1', name: 'logo.png', type: 'image', assetId: 'a1',
			trackId: 't2', timelineStart: 0, duration: 5,
		}),
		scratchName: 'media_a1.png',
		sourceTime: 0,
		width: 480,
		still: false,
		...over,
	};
}

describe('first look at a layer', () => {
	it('has nothing to draw yet', () => {
		const cache = new OverlayFrameCache(async () => bitmap());

		expect(cache.get(request())).toBeNull();
	});

	it('starts the decode', () => {
		const load = vi.fn(async () => bitmap());
		const cache = new OverlayFrameCache(load);

		cache.get(request());

		expect(load).toHaveBeenCalledWith('media_a1.png', 0, 480);
	});

	it('says when the frame has landed, so the caller can repaint', async () => {
		const cache = new OverlayFrameCache(async () => bitmap());
		const onReady = vi.fn();

		cache.get(request(), onReady);
		await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
	});

	it('hands the frame back once it is there', async () => {
		const frame = bitmap();
		const cache = new OverlayFrameCache(async () => frame);

		cache.get(request());
		await vi.waitFor(() => expect(cache.get(request())).toBe(frame));
	});
});

describe('not decoding more than it has to', () => {
	it('asks once while a decode is in flight', () => {
		const load = vi.fn(() => new Promise<ImageBitmap | null>(() => {}));
		const cache = new OverlayFrameCache(load);

		cache.get(request());
		cache.get(request());
		cache.get(request());

		expect(load).toHaveBeenCalledTimes(1);
	});

	it('reuses one frame across a small time step', async () => {
		const load = vi.fn(async () => bitmap());
		const cache = new OverlayFrameCache(load);

		cache.get(request({ sourceTime: 1 }));
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
		cache.get(request({ sourceTime: 1.01 }));

		expect(load).toHaveBeenCalledTimes(1);
	});

	it('decodes again once the playhead has moved far enough', async () => {
		const load = vi.fn(async () => bitmap());
		const cache = new OverlayFrameCache(load);

		cache.get(request({ sourceTime: 1 }));
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
		cache.get(request({ sourceTime: 3 }));

		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
	});

	it('decodes a still image once however far the playhead moves', async () => {
		const load = vi.fn(async () => bitmap());
		const cache = new OverlayFrameCache(load);

		cache.get(request({ still: true, sourceTime: 0 }));
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
		cache.get(request({ still: true, sourceTime: 30 }));

		expect(load).toHaveBeenCalledTimes(1);
	});

	it('asks a still image for time zero, not for wherever the playhead is', () => {
		const load = vi.fn(async () => bitmap());
		const cache = new OverlayFrameCache(load);

		cache.get(request({ still: true, sourceTime: 30 }));

		expect(load).toHaveBeenCalledWith('media_a1.png', 0, 480);
	});
});

describe('while the next frame is decoding', () => {
	it('draws the last frame it had for that asset rather than a hole', async () => {
		const first = bitmap();
		let next: ImageBitmap | null = first;
		const cache = new OverlayFrameCache(async () => next);

		cache.get(request({ sourceTime: 0 }));
		await vi.waitFor(() => expect(cache.get(request({ sourceTime: 0 }))).toBe(first));

		next = null;
		expect(cache.get(request({ sourceTime: 9 }))).toBe(first);
	});

	it('does not borrow a frame from a different asset', async () => {
		const frame = bitmap();
		const cache = new OverlayFrameCache(async () => frame);

		cache.get(request());
		await vi.waitFor(() => expect(cache.get(request())).toBe(frame));

		const other = createClip({
			id: 'c2', name: 'b.mp4', type: 'video', assetId: 'a2',
			trackId: 't3', timelineStart: 0, duration: 5,
		});
		expect(cache.get(request({ clip: other, scratchName: 'media_a2.mp4' }))).toBeNull();
	});

	it('survives a decode that fails', async () => {
		const load = vi.fn(async () => { throw new Error('no such frame'); });
		const cache = new OverlayFrameCache(load);

		expect(cache.get(request())).toBeNull();

		// And it is allowed to try again rather than being stuck pending
		// forever on the failed key.
		await vi.waitFor(() => {
			cache.get(request());
			expect(load).toHaveBeenCalledTimes(2);
		});
	});
});

describe('memory', () => {
	it('drops the oldest frames rather than growing without bound', async () => {
		const frames: ImageBitmap[] = [];
		const cache = new OverlayFrameCache(async () => {
			const frame = bitmap();
			frames.push(frame);
			return frame;
		}, 2);

		for (const time of [0, 1, 2]) {
			cache.get(request({ sourceTime: time }));
			await vi.waitFor(() => expect(frames.length).toBe(time + 1));
		}

		expect(frames[0].close).toHaveBeenCalled();
		expect(frames[2].close).not.toHaveBeenCalled();
	});

	it('releases everything on clear', async () => {
		const frame = bitmap();
		const cache = new OverlayFrameCache(async () => frame);

		cache.get(request());
		await vi.waitFor(() => expect(cache.get(request())).toBe(frame));
		cache.clear();

		expect(frame.close).toHaveBeenCalled();
		expect(cache.get(request())).toBeNull();
	});
});
