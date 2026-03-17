<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { getPlayback, getTimeline, getMediaLibrary, getProject, getCaptions } from '$lib/state/context.js';
	import { renderTextOverlays, renderCaptions, renderShapeOverlays } from '$lib/engine/preview-renderer.js';
	import { buildCssFilterString } from '$lib/utils/filter-presets.js';
	import { applyChromaKey } from '$lib/utils/chroma-key.js';
	import { hasNonDefaultPosition } from '$lib/utils/pip-presets.js';
	import { buildVideoEffectCss } from '$lib/utils/video-effects.js';
	import { DEFAULT_CLIP_POSITION } from '$lib/types/timeline.js';
	import { getUI } from '$lib/state/context.js';
	import TransportControls from './TransportControls.svelte';
	import type { Clip } from '$lib/types/index.js';

	const playback = getPlayback();
	const timeline = getTimeline();
	const mediaLibrary = getMediaLibrary();
	const project = getProject();
	const captions = getCaptions();
	const ui = getUI();

	let videoEl: HTMLVideoElement;
	let overlayCanvas: HTMLCanvasElement;
	let chromaCanvas: HTMLCanvasElement;
	let viewportEl: HTMLDivElement;
	let rafId: number | null = null;
	let lastRafTime = 0;
	let dpr = 1;

	let previewContainerEl: HTMLDivElement;
	let activeAssetId: string | null = null;
	let activeClipId: string | null = null;
	let chromaKeyActive = false;

	function toggleFullscreen() {
		if (!previewContainerEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
			ui.previewFullscreen = false;
		} else {
			previewContainerEl.requestFullscreen().catch(() => {});
			ui.previewFullscreen = true;
		}
	}

	function toggleFillMode() {
		ui.previewFillMode = ui.previewFillMode === 'fit' ? 'fill' : 'fit';
	}

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

	/** Calculate the source time for a clip, accounting for reverse playback. */
	function getSourceTime(clip: Clip, timelineTime: number): number {
		const elapsed = timelineTime - clip.timelineStart;
		if (clip.reversed) {
			// Map playback position inversely: play from sourceEnd backwards
			return clip.sourceEnd - elapsed;
		}
		return clip.sourceStart + elapsed;
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

		// Apply per-clip CSS filters, transforms, and position to the video element
		applyVideoFilters(clip);
		applyVideoTransforms(clip);
		applyVideoPosition(clip);
		applyChromaKeyEffect(clip);

		return true;
	}

	function applyVideoFilters(clip: Clip): void {
		if (!videoEl || !clip.filters) return;
		let filterStr = buildCssFilterString(clip.filters);

		// Apply video effect on top of clip filters
		const effect = clip.videoEffect;
		if (effect && effect.type !== 'none') {
			const effectCss = buildVideoEffectCss(effect.type, effect.intensity, playback.currentTime);
			if (effectCss.filter) {
				filterStr = filterStr === 'none' ? effectCss.filter : `${filterStr} ${effectCss.filter}`;
			}
			if (effectCss.transform) {
				const existingTransform = videoEl.style.transform || '';
				videoEl.style.transform = existingTransform ? `${existingTransform} ${effectCss.transform}` : effectCss.transform;
			}
		}

		videoEl.style.filter = filterStr === 'none' ? '' : filterStr;
	}

	function applyChromaKeyEffect(clip: Clip): void {
		if (!videoEl || !chromaCanvas) return;

		const ck = clip.chromaKey;
		chromaKeyActive = ck?.enabled ?? false;

		if (!chromaKeyActive) {
			// Hide chroma canvas, show video normally
			chromaCanvas.style.display = 'none';
			videoEl.style.opacity = '';
			return;
		}

		// Show chroma canvas over video
		chromaCanvas.style.display = 'block';
		videoEl.style.opacity = '0';
	}

	function processChromaKeyFrame(): void {
		if (!chromaKeyActive || !videoEl || !chromaCanvas) return;
		if (videoEl.readyState < 2) return;

		const ctx = chromaCanvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return;

		const w = chromaCanvas.width;
		const h = chromaCanvas.height;
		if (w === 0 || h === 0) return;

		// Draw the current video frame
		ctx.drawImage(videoEl, 0, 0, w, h);

		// Get pixel data and apply chroma key
		const clip = findActiveClip();
		if (!clip?.chromaKey?.enabled) return;

		const imageData = ctx.getImageData(0, 0, w, h);
		applyChromaKey(imageData, clip.chromaKey);
		ctx.putImageData(imageData, 0, 0);
	}

	function resizeChromaCanvas(): void {
		if (!chromaCanvas || !viewportEl) return;
		const rect = viewportEl.getBoundingClientRect();
		chromaCanvas.width = Math.round(rect.width);
		chromaCanvas.height = Math.round(rect.height);
		chromaCanvas.style.width = rect.width + 'px';
		chromaCanvas.style.height = rect.height + 'px';
	}

	function applyVideoTransforms(clip: Clip): void {
		if (!videoEl) return;

		const parts: string[] = [];

		// Rotation
		const rotation = clip.transform?.rotation ?? 0;
		if (rotation !== 0) {
			parts.push(`rotate(${rotation}deg)`);
		}

		// Flip
		const scaleX = clip.transform?.flipH ? -1 : 1;
		const scaleY = clip.transform?.flipV ? -1 : 1;
		if (scaleX !== 1 || scaleY !== 1) {
			parts.push(`scale(${scaleX}, ${scaleY})`);
		}

		// For 90/270 rotations, scale down so the rotated video fits within the container
		if (rotation === 90 || rotation === 270) {
			if (viewportEl) {
				const rect = viewportEl.getBoundingClientRect();
				const ratio = Math.min(rect.width / rect.height, rect.height / rect.width);
				parts.push(`scale(${ratio})`);
			}
		}

		videoEl.style.transform = parts.length > 0 ? parts.join(' ') : '';

		// Crop via clip-path (inset)
		const crop = clip.crop;
		if (crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0)) {
			videoEl.style.clipPath = `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`;
		} else {
			videoEl.style.clipPath = '';
		}
	}

	function applyVideoPosition(clip: Clip): void {
		if (!videoEl) return;
		const pos = clip.position ?? DEFAULT_CLIP_POSITION;

		if (hasNonDefaultPosition(pos)) {
			videoEl.style.left = `${pos.x}%`;
			videoEl.style.top = `${pos.y}%`;
			videoEl.style.width = `${pos.width}%`;
			videoEl.style.height = `${pos.height}%`;
			videoEl.style.zIndex = String(pos.zIndex);
			videoEl.style.inset = 'auto';
		} else {
			videoEl.style.left = '';
			videoEl.style.top = '';
			videoEl.style.width = '100%';
			videoEl.style.height = '100%';
			videoEl.style.zIndex = '';
			videoEl.style.inset = '0';
		}
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

		const sourceTime = getSourceTime(clip, playback.currentTime);
		videoEl.currentTime = sourceTime;
		videoEl.volume = getClipVolume(clip);
		videoEl.muted = false;

		if (clip.reversed) {
			// Reversed clips: pause video and seek manually each frame via RAF
			videoEl.pause();
		} else {
			videoEl.playbackRate = clip.speed * playback.playbackRate;
			// This play() call is in direct click context — guaranteed to work
			videoEl.play().then(() => {
				console.log('[MEOW] Audio playing:', { muted: videoEl.muted, volume: videoEl.volume });
			}).catch((err) => {
				console.error('[MEOW] Play failed:', err.name, err.message);
			});
		}

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
					videoEl.currentTime = clip.reversed ? clip.sourceEnd : clip.sourceStart;
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
				const sourceTime = getSourceTime(clip, playback.currentTime);
				videoEl.currentTime = sourceTime;
				videoEl.volume = getClipVolume(clip);
				videoEl.muted = false;
				if (clip.reversed) {
					// Reversed: pause video, seek manually each frame
					videoEl.pause();
				} else {
					videoEl.playbackRate = clip.speed * playback.playbackRate;
					videoEl.play().catch(() => {});
				}
			} else {
				videoEl?.pause();
				activeClipId = null;
			}
		}

		// 4. Drift correction / reverse seek — only if > 0.45s off (Remotion approach)
		if (clip && !clipChanged && videoEl) {
			const expected = getSourceTime(clip, playback.currentTime);
			if (clip.reversed) {
				// Reversed clips: always seek manually since video is paused
				videoEl.currentTime = expected;
			} else if (Math.abs(videoEl.currentTime - expected) > 0.45) {
				videoEl.currentTime = expected;
			}
		}

		// 5. Text overlays
		drawTextOverlays();

		// 6. Chroma key frame processing
		processChromaKeyFrame();

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
					const sourceTime = getSourceTime(clip, playback.currentTime);
					videoEl.currentTime = sourceTime;
					videoEl.volume = getClipVolume(clip);
					videoEl.muted = false;
					if (clip.reversed) {
						videoEl.pause();
					} else {
						videoEl.playbackRate = clip.speed * playback.playbackRate;
						videoEl.play().catch(() => {});
					}
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
					const sourceTime = getSourceTime(clip, playback.currentTime);
					if (Math.abs(videoEl.currentTime - sourceTime) > 0.04) {
						videoEl.currentTime = sourceTime;
					}
				}
				drawTextOverlays();
				processChromaKeyFrame();
			});
		}
	});

	// ── Reactively apply CSS filters and transforms when clip properties change ───────
	$effect(() => {
		// Track changes to timeline.tracks (triggers on filter/transform updates)
		void timeline.tracks;
		if (!videoEl) return;
		untrack(() => {
			const clip = findActiveClip();
			if (clip) {
				applyVideoFilters(clip);
				applyVideoTransforms(clip);
				applyVideoPosition(clip);
				applyChromaKeyEffect(clip);
				processChromaKeyFrame();
			} else {
				videoEl.style.filter = '';
				videoEl.style.transform = '';
				videoEl.style.clipPath = '';
				videoEl.style.inset = '0';
				videoEl.style.left = '';
				videoEl.style.top = '';
				videoEl.style.width = '100%';
				videoEl.style.height = '100%';
				videoEl.style.zIndex = '';
				chromaKeyActive = false;
				if (chromaCanvas) chromaCanvas.style.display = 'none';
			}
		});
	});

	// ── Reactively redraw overlays when text/shape overlays change while paused ──
	$effect(() => {
		void timeline.textOverlays;
		void timeline.shapeOverlays;
		if (!playback.playing) {
			untrack(() => {
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
		resizeChromaCanvas();
	}

	function drawTextOverlays() {
		if (!overlayCanvas) return;
		const ctx = overlayCanvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

		const w = overlayCanvas.width / dpr;
		const h = overlayCanvas.height / dpr;

		if (timeline.textOverlays.length > 0) {
			ctx.save();
			ctx.scale(dpr, dpr);
			renderTextOverlays(ctx, timeline.textOverlays, playback.currentTime, w, h);
			ctx.restore();
		}

		if (timeline.shapeOverlays.length > 0) {
			ctx.save();
			ctx.scale(dpr, dpr);
			renderShapeOverlays(ctx, timeline.shapeOverlays, playback.currentTime, w, h);
			ctx.restore();
		}

		if (captions.isEnabled) {
			ctx.save();
			ctx.scale(dpr, dpr);
			renderCaptions(ctx, captions.captionTrack, playback.currentTime, w, h);
			ctx.restore();
		}
	}
</script>

<svelte:window onresize={resizeOverlay} />

<div class="preview-panel" bind:this={previewContainerEl}>
	<div class="preview-viewport">
		<div class="preview-toolbar">
			<button class="preview-btn" onclick={toggleFillMode} title={ui.previewFillMode === 'fit' ? 'Fill' : 'Fit'}>
				{ui.previewFillMode === 'fit' ? 'Fit' : 'Fill'}
			</button>
			<button class="preview-btn" onclick={toggleFullscreen} title="Toggle fullscreen (F)">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					{#if ui.previewFullscreen}
						<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
					{:else}
						<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
					{/if}
				</svg>
			</button>
		</div>
		<div
			class="preview-inner"
			bind:this={viewportEl}
			style="aspect-ratio: {project.aspectRatio.width} / {project.aspectRatio.height};"
		>
			<video
				bind:this={videoEl}
				playsinline
				preload="auto"
				class="preview-video"
				style="object-fit: {ui.previewFillMode === 'fill' ? 'cover' : 'contain'};"
			></video>
			<canvas class="chroma-key-canvas" bind:this={chromaCanvas} style="display: none;"></canvas>
			<canvas class="text-overlay" bind:this={overlayCanvas}></canvas>
			{#if timeline.tracks.length === 0}
				<div class="empty-state">
					<p>Import media and add clips to the timeline to preview</p>
				</div>
			{/if}
		</div>
	</div>
	<TransportControls onplayclick={handlePlayClick} onfullscreen={toggleFullscreen} />
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
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000000;
		min-height: 0;
		overflow: hidden;
		padding: 8px;
		position: relative;
	}

	.preview-toolbar {
		position: absolute;
		top: 8px;
		right: 12px;
		z-index: 30;
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.preview-viewport:hover .preview-toolbar {
		opacity: 1;
	}

	.preview-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px 8px;
		background: rgba(0, 0, 0, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		color: rgba(255, 255, 255, 0.8);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
		backdrop-filter: blur(4px);
		transition: background 0.15s, color 0.15s;
	}

	.preview-btn:hover {
		background: rgba(0, 0, 0, 0.8);
		color: #ffffff;
	}

	.preview-inner {
		position: relative;
		max-width: 100%;
		max-height: 100%;
		width: 100%;
		background: #111;
		overflow: hidden;
		border-radius: 2px;
	}

	.preview-video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
	}

	.chroma-key-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 5;
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
