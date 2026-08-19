import type { Clip } from '$lib/types/timeline.js';

/**
 * Frames for the layers drawn on top of the preview.
 *
 * The base clip is decoded by the existing native stream; these are the
 * layers above it — a title card, a logo, a second angle — and each needs a
 * picture at the current moment without a decoder of its own.
 *
 * Decoding is asynchronous and drawing is not, so this holds the newest frame
 * it has and hands it back immediately. An overlay one frame behind while
 * scrubbing is not worth stalling the preview for; an overlay missing
 * entirely, which is what the preview did before, is.
 */

export type FrameLoader = (scratchName: string, time: number, width: number) => Promise<ImageBitmap | null>;

/** How finely video overlay frames are cached, in seconds. */
const FRAME_QUANTUM = 1 / 12;

export interface OverlayFrameRequest {
	clip: Clip;
	scratchName: string;
	/** Time within the source, already mapped from timeline time. */
	sourceTime: number;
	/** Decode width. Overlays are small on screen; full resolution is waste. */
	width: number;
	/** Images have one frame, so they are cached once rather than per moment. */
	still: boolean;
}

export class OverlayFrameCache {
	#frames = new Map<string, ImageBitmap>();
	#pending = new Set<string>();
	#load: FrameLoader;
	#limit: number;
	/** Insertion order, so the oldest entry can be dropped when full. */
	#order: string[] = [];

	constructor(load: FrameLoader, limit = 48) {
		this.#load = load;
		this.#limit = limit;
	}

	/**
	 * The best frame available for a layer right now, decoding if needed.
	 *
	 * Returns null the first time a frame is asked for; the decode is started
	 * and `onReady` fires once it lands, so the caller can repaint.
	 */
	get(request: OverlayFrameRequest, onReady?: () => void): ImageBitmap | null {
		const key = this.#key(request);
		const cached = this.#frames.get(key);
		if (cached) return cached;

		if (!this.#pending.has(key)) {
			this.#pending.add(key);
			void this.#load(request.scratchName, request.still ? 0 : request.sourceTime, request.width)
				.then((bitmap) => {
					this.#pending.delete(key);
					if (!bitmap) return;
					this.#store(key, bitmap);
					onReady?.();
				})
				.catch(() => {
					this.#pending.delete(key);
				});
		}

		// Something to draw while that runs, if any frame of this asset is
		// already known. A slightly stale overlay beats a hole.
		return this.#nearest(request);
	}

	/** Drops everything. Called when the timeline changes underneath. */
	clear(): void {
		for (const bitmap of this.#frames.values()) bitmap.close();
		this.#frames.clear();
		this.#order = [];
	}

	#key(request: OverlayFrameRequest): string {
		if (request.still) return `${request.clip.assetId}:still`;
		const bucket = Math.round(Math.max(0, request.sourceTime) / FRAME_QUANTUM);
		return `${request.clip.assetId}:${bucket}`;
	}

	#nearest(request: OverlayFrameRequest): ImageBitmap | null {
		const prefix = `${request.clip.assetId}:`;
		// Walk newest first: the last frame drawn for this asset is the one
		// most likely to still look right.
		for (let i = this.#order.length - 1; i >= 0; i--) {
			if (this.#order[i].startsWith(prefix)) return this.#frames.get(this.#order[i]) ?? null;
		}
		return null;
	}

	#store(key: string, bitmap: ImageBitmap): void {
		this.#frames.set(key, bitmap);
		this.#order.push(key);

		while (this.#order.length > this.#limit) {
			const oldest = this.#order.shift()!;
			this.#frames.get(oldest)?.close();
			this.#frames.delete(oldest);
		}
	}
}
