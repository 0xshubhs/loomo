<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { getPlayback, getTimeline, getMediaLibrary } from '$lib/state/context.js';
	import { renderTextOverlays } from '$lib/engine/preview-renderer.js';
	import TransportControls from './TransportControls.svelte';
	import type { Clip } from '$lib/types/index.js';

	const playback = getPlayback();
	const timeline = getTimeline();
	const mediaLibrary = getMediaLibrary();

	let videoEl: HTMLVideoElement;
	let overlayCanvas: HTMLCanvasElement;
	let viewportEl: HTMLDivElement;
	let rafId: number | null = null;
	let lastRafTime = 0;
	let dpr = 1;

	let activeAssetId: string | null = null;
	let activeClipId: string | null = null;

	onMount(() => {
		dpr = window.devicePixelRatio || 1;
		resizeOverlay();
	});

	onDestroy(() => {
		stopLoop();
		videoEl?.pause();
	});

	// ── Helpers ─────────────────────────────────────────────────────

	function findActiveClip(): Clip | null {
		for (const track of timeline.tracks) {
			if (track.type !== 'video' || !track.visible) continue;
			for (const clip of track.clips) {
				if (
					playback.currentTime >= clip.timelineStart &&
					playback.currentTime < clip.timelineStart + clip.duration
				) {
					return clip;
				}
			}
		}
		return null;
	}

	function getClipVolume(clip: Clip): number {
		const track = timeline.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
		if (track?.muted || clip.muted) return 0;
		return Math.max(0, Math.min(1, (track?.volume ?? 1) * clip.volume));
	}

	function setupVideo(clip: Clip): boolean {
		if (!videoEl) return false;
		const asset = mediaLibrary.getAssetById(clip.assetId);
		if (!asset) return false;

		// Only change src if different asset
		if (activeAssetId !== clip.assetId) {
			videoEl.src = asset.blobUrl;
			activeAssetId = clip.assetId;
		}
		activeClipId = clip.id;
		return true;
	}

	// ── Play/Pause called DIRECTLY from click handler ───────────────
	// This runs in user gesture context — browser MUST allow audio.

	function handlePlayClick() {
		if (playback.playing) {
			// Currently playing → will pause
			stopLoop();
			videoEl?.pause();
			return;
		}

		// Currently paused → will play
		const clip = findActiveClip();
		if (!clip || !videoEl) return;
		if (!setupVideo(clip)) return;

		const sourceTime = clip.sourceStart + (playback.currentTime - clip.timelineStart);
		videoEl.currentTime = sourceTime;
		videoEl.volume = getClipVolume(clip);
		videoEl.playbackRate = clip.speed;
		videoEl.muted = false;

		// This play() call is in direct click context — guaranteed to work
		videoEl.play().then(() => {
			console.log('[MEOW] Audio playing:', { muted: videoEl.muted, volume: videoEl.volume });
		}).catch((err) => {
			console.error('[MEOW] Play failed:', err.name, err.message);
		});

		// Start the RAF loop for timeline time advancement
		startLoop();
	}

	// ── RAF Loop ────────────────────────────────────────────────────

	function startLoop() {
		stopLoop();
		lastRafTime = performance.now();
		tick(lastRafTime);
	}

	function stopLoop() {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function tick(now: number) {
		if (!playback.playing) {
			stopLoop();
			return;
		}

		const dt = (now - lastRafTime) / 1000;
		lastRafTime = now;

		// 1. Advance timeline clock
		playback.currentTime += dt * playback.playbackRate;

		// 2. End / loop
		if (playback.currentTime >= timeline.totalDuration) {
			if (playback.loopEnabled) {
				playback.currentTime = 0;
				const clip = findActiveClip();
				if (clip) {
					setupVideo(clip);
					videoEl.currentTime = clip.sourceStart;
					videoEl.play().catch(() => {});
				}
			} else {
				playback.pause();
				stopLoop();
				return;
			}
		}

		// 3. Clip boundary transition
		const clip = findActiveClip();
		const clipChanged =
			(clip && clip.id !== activeClipId) || (!clip && activeClipId !== null);

		if (clipChanged) {
			if (clip) {
				setupVideo(clip);
				const sourceTime = clip.sourceStart + (playback.currentTime - clip.timelineStart);
				videoEl.currentTime = sourceTime;
				videoEl.volume = getClipVolume(clip);
				videoEl.playbackRate = clip.speed;
				videoEl.muted = false;
				videoEl.play().catch(() => {});
			} else {
				videoEl?.pause();
				activeClipId = null;
			}
		}

		// 4. Drift correction — only if > 0.45s off (Remotion approach)
		if (clip && !clipChanged && videoEl) {
			const expected = clip.sourceStart + (playback.currentTime - clip.timelineStart);
			if (Math.abs(videoEl.currentTime - expected) > 0.45) {
				videoEl.currentTime = expected;
			}
		}

		// 5. Text overlays
		drawTextOverlays();

		rafId = requestAnimationFrame(tick);
	}

	// ── Playback state sync (for Space key and other triggers) ──────
	$effect(() => {
		if (!videoEl) return;

		if (playback.playing) {
			// If play was triggered by something other than the play button
			// (e.g., Space key), the RAF loop might not be running yet
			if (rafId === null) {
				const clip = findActiveClip();
				if (clip) {
					setupVideo(clip);
					const sourceTime = clip.sourceStart + (playback.currentTime - clip.timelineStart);
					videoEl.currentTime = sourceTime;
					videoEl.volume = getClipVolume(clip);
					videoEl.playbackRate = clip.speed;
					videoEl.muted = false;
					videoEl.play().catch(() => {});
					startLoop();
				}
			}
		} else {
			stopLoop();
			videoEl.pause();
		}
	});

	// ── Scrub while paused ──────────────────────────────────────────
	$effect(() => {
		void playback.currentTime;
		if (!playback.playing && videoEl) {
			untrack(() => {
				const clip = findActiveClip();
				if (clip) {
					setupVideo(clip);
					const sourceTime = clip.sourceStart + (playback.currentTime - clip.timelineStart);
					if (Math.abs(videoEl.currentTime - sourceTime) > 0.04) {
						videoEl.currentTime = sourceTime;
					}
				}
				drawTextOverlays();
			});
		}
	});

	// ── Overlay canvas ──────────────────────────────────────────────

	function resizeOverlay() {
		if (!overlayCanvas || !viewportEl) return;
		const rect = viewportEl.getBoundingClientRect();
		dpr = window.devicePixelRatio || 1;
		overlayCanvas.width = Math.round(rect.width * dpr);
		overlayCanvas.height = Math.round(rect.height * dpr);
		overlayCanvas.style.width = rect.width + 'px';
		overlayCanvas.style.height = rect.height + 'px';
	}

	function drawTextOverlays() {
		if (!overlayCanvas) return;
		const ctx = overlayCanvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
		if (timeline.textOverlays.length === 0) return;
		ctx.save();
		ctx.scale(dpr, dpr);
		renderTextOverlays(
			ctx,
			timeline.textOverlays,
			playback.currentTime,
			overlayCanvas.width / dpr,
			overlayCanvas.height / dpr
		);
		ctx.restore();
	}
</script>

<svelte:window onresize={resizeOverlay} />

<div class="preview-panel">
	<div class="preview-viewport" bind:this={viewportEl}>
		<!-- Single visible video element — browser handles display + audio natively -->
		<video
			bind:this={videoEl}
			playsinline
			preload="auto"
			class="preview-video"
		></video>
		<!-- Transparent canvas for text overlays only -->
		<canvas class="text-overlay" bind:this={overlayCanvas}></canvas>
		{#if timeline.tracks.length === 0}
			<div class="empty-state">
				<p>Import media and add clips to the timeline to preview</p>
			</div>
		{/if}
	</div>
	<TransportControls onplayclick={handlePlayClick} />
</div>

<style>
	.preview-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-primary);
	}

	.preview-viewport {
		flex: 1;
		position: relative;
		background: #000000;
		min-height: 0;
		overflow: hidden;
	}

	.preview-video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
	}

	.text-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 10;
	}

	.empty-state {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 20;
	}

	.empty-state p {
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
