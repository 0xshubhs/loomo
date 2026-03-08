import type { Track, Clip } from '$lib/types/index.js';

/**
 * Production playback engine — visible <video> element architecture.
 *
 * Previous approach (hidden video + canvas drawImage) failed audio 3 times.
 * This approach uses VISIBLE <video> elements in the preview viewport:
 *
 * 1. Video elements are created inside a container div in the preview panel.
 * 2. Only the active video is visible (display:block), others are hidden.
 * 3. The browser handles native video display AND audio output directly.
 * 4. A transparent canvas overlay on top handles text overlays only.
 *
 * Timing follows Remotion-style:
 * - OUR TIMELINE IS THE MASTER CLOCK — we advance playback.currentTime via RAF.
 * - THE VIDEO ELEMENT PLAYS ALONG — we call video.play() once and let it run.
 * - LAZY DRIFT CORRECTION — only seek if drift exceeds 0.45s.
 * - VOLUME IS SET ONCE per play/transition, never per-frame.
 */
export class PlaybackEngine {
	private videoElements = new Map<string, HTMLVideoElement>();
	private _activeClipId: string | null = null;
	private _activeAssetId: string | null = null;
	private _playing = false;
	private container: HTMLElement | null = null;

	/** Remotion uses 0.45s — large enough to avoid constant seeking,
	 *  small enough to keep audio roughly in sync. */
	private readonly DRIFT_THRESHOLD = 0.45;

	// ── Container ──────────────────────────────────────────────────

	/** Set the DOM container where video elements will be placed (visible). */
	setContainer(container: HTMLElement): void {
		this.container = container;
	}

	// ── Element lifecycle ───────────────────────────────────────────

	createVideoElement(assetId: string, blobUrl: string): HTMLVideoElement {
		let video = this.videoElements.get(assetId);
		if (video) return video;

		video = document.createElement('video');
		video.preload = 'auto';
		video.playsInline = true;
		video.muted = true; // Start muted, unmuted on play()
		video.src = blobUrl;

		// Visible inside the preview container — browser handles display + audio natively
		video.style.cssText =
			'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none;';

		if (this.container) {
			this.container.appendChild(video);
		} else {
			// Fallback if container not set yet — append to body hidden
			video.style.cssText =
				'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;opacity:0;';
			document.body.appendChild(video);
		}

		this.videoElements.set(assetId, video);
		return video;
	}

	getVideoElement(assetId: string): HTMLVideoElement | undefined {
		return this.videoElements.get(assetId);
	}

	/** Show only the specified video element, hide all others. */
	showVideo(assetId: string | null): void {
		for (const [id, video] of this.videoElements) {
			video.style.display = id === assetId ? 'block' : 'none';
		}
	}

	// ── Clip lookup ─────────────────────────────────────────────────

	getActiveClip(tracks: Track[], currentTime: number): Clip | null {
		for (const track of tracks) {
			if (track.type !== 'video' || !track.visible) continue;
			for (const clip of track.clips) {
				if (
					currentTime >= clip.timelineStart &&
					currentTime < clip.timelineStart + clip.duration
				) {
					return clip;
				}
			}
		}
		return null;
	}

	// ── Playback control ────────────────────────────────────────────

	/**
	 * Start playing a clip. Shows the video, seeks once, sets volume, calls play().
	 * Safe to call from user-gesture context (click handlers / effects).
	 */
	play(clip: Clip | null, tracks: Track[], timelineTime: number): void {
		this._playing = true;

		// Pause every element that isn't the target clip
		for (const [id, video] of this.videoElements) {
			if (!clip || id !== clip.assetId) {
				video.pause();
			}
		}

		this._activeClipId = clip?.id ?? null;
		this._activeAssetId = clip?.assetId ?? null;

		// Show the active video, hide others
		this.showVideo(clip?.assetId ?? null);

		if (!clip) return;

		const video = this.videoElements.get(clip.assetId);
		if (!video) return;

		// Volume — set ONCE, not every frame
		const vol = this._computeVolume(clip, tracks);
		video.volume = vol;
		video.playbackRate = clip.speed;

		// Seek to correct source position — ONE TIME
		const sourceTime = clip.sourceStart + (timelineTime - clip.timelineStart);
		video.currentTime = sourceTime;

		// Unmute and play.
		// Chrome/Brave have "sticky activation" — once the user has interacted
		// with the page (clicking play), unmuted playback works from any context.
		video.muted = false;
		video.play().catch((err) => {
			if (err.name === 'NotAllowedError') {
				// First-ever interaction hasn't happened yet — play muted
				// so at least video frames render. Audio enables on next click.
				console.warn('Autoplay blocked — click anywhere to enable audio.');
				video.muted = true;
				video.play().catch(() => {});
			}
			// AbortError = play() interrupted by pause() — harmless, ignore.
		});
	}

	/**
	 * Transition to a different clip during active playback.
	 * Only call when the active clip changes (boundary crossing).
	 */
	transitionTo(clip: Clip | null, tracks: Track[], timelineTime: number): void {
		if (!this._playing) return;
		this.play(clip, tracks, timelineTime);
	}

	/**
	 * Lazy drift correction — called each frame but only seeks when
	 * the video has drifted more than 0.45s from the expected position.
	 * Returns true if a correction was made.
	 */
	correctDrift(clip: Clip, timelineTime: number): boolean {
		const video = this.videoElements.get(clip.assetId);
		if (!video) return false;

		const expectedSource = clip.sourceStart + (timelineTime - clip.timelineStart);
		const drift = Math.abs(video.currentTime - expectedSource);

		if (drift > this.DRIFT_THRESHOLD) {
			video.currentTime = expectedSource;
			return true;
		}
		return false;
	}

	/**
	 * Update volume without seeking. Call when the user changes
	 * track/clip volume or mute state mid-playback.
	 */
	updateVolume(clip: Clip, tracks: Track[]): void {
		const video = this.videoElements.get(clip.assetId);
		if (!video) return;
		video.volume = this._computeVolume(clip, tracks);
	}

	pauseAll(): void {
		this._playing = false;
		this._activeClipId = null;
		this._activeAssetId = null;
		for (const video of this.videoElements.values()) {
			video.pause();
		}
	}

	get activeClipId(): string | null {
		return this._activeClipId;
	}

	get activeAssetId(): string | null {
		return this._activeAssetId;
	}

	get isPlaying(): boolean {
		return this._playing;
	}

	// ── Scrubbing (paused only) ─────────────────────────────────────

	scrubTo(clip: Clip, timelineTime: number): void {
		const video = this.videoElements.get(clip.assetId);
		if (!video) return;

		// Show this video while scrubbing
		this.showVideo(clip.assetId);
		this._activeAssetId = clip.assetId;
		this._activeClipId = clip.id;

		const sourceTime = clip.sourceStart + (timelineTime - clip.timelineStart);
		// Threshold of 0.04s avoids unnecessary seeks while scrubbing
		if (Math.abs(video.currentTime - sourceTime) > 0.04) {
			video.currentTime = sourceTime;
		}
	}

	// ── Cleanup ─────────────────────────────────────────────────────

	destroy(): void {
		this.pauseAll();
		for (const video of this.videoElements.values()) {
			video.src = '';
			video.remove();
		}
		this.videoElements.clear();
		this.container = null;
	}

	// ── Private helpers ─────────────────────────────────────────────

	private _computeVolume(clip: Clip, tracks: Track[]): number {
		const track = tracks.find((t) => t.clips.some((c) => c.id === clip.id));
		const trackMuted = track?.muted ?? false;
		if (trackMuted || clip.muted) return 0;
		return Math.max(0, Math.min(1, (track?.volume ?? 1) * clip.volume));
	}
}
