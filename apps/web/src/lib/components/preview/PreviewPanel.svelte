<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { getPlayback, getTimeline, getMediaLibrary, getProject, getCaptions, getSelection } from '$lib/state/context.js';
	import { renderTextOverlays, renderCaptions, renderShapeOverlays } from '$lib/engine/preview-renderer.js';
	import { buildCssFilterString } from '$lib/utils/filter-presets.js';
	import { applyChromaKey } from '$lib/utils/chroma-key.js';
	import { hasNonDefaultPosition } from '$lib/utils/pip-presets.js';
	import { buildVideoEffectCss } from '$lib/utils/video-effects.js';
	import { buildKeyframeCss } from '$lib/utils/keyframe-css.js';
	import { DEFAULT_CLIP_POSITION } from '$lib/types/timeline.js';
	import { getUI } from '$lib/state/context.js';
	import { isDesktop } from '$lib/desktop/env.js';
	import type { FFmpegEngine } from '$lib/engine/ffmpeg-engine.js';
	import { loadAudioWindow, clearAudioCache, NativeAudioPlayer } from '$lib/engine/native-audio.js';
	import {
		WINDOW_SECONDS,
		windowIndexFor,
		windowStart,
		offsetInWindow,
		windowToPrefetch,
	} from '$lib/playback/audio-windows.js';
	import { NativePreviewStream, nativeFrameAt } from '$lib/engine/native-preview.js';
	import TransportControls from './TransportControls.svelte';
	import AnnotationLayer from './AnnotationLayer.svelte';
	import MosaicLayer from './MosaicLayer.svelte';
	import { visibleLayers, overlayLayers, baseLayer, layerRect, type PreviewLayer } from '$lib/playback/preview-composite.js';
	import { OverlayFrameCache } from '$lib/playback/overlay-frames.js';
	import { audioBedClips, diffBed, bedSourceTime } from '$lib/playback/preview-mixer.js';
	import type { Clip } from '$lib/types/index.js';

	interface Props {
		/** Needed to extract preview audio with the bundled ffmpeg. */
		ffmpeg?: FFmpegEngine;
	}

	let { ffmpeg }: Props = $props();

	const playback = getPlayback();
	const timeline = getTimeline();
	const mediaLibrary = getMediaLibrary();
	const project = getProject();
	const captions = getCaptions();
	const selection = getSelection();
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

	// Native preview: frames decoded by the bundled ffmpeg, painted here.
	// Active whenever the clip's asset has a scratch copy on the desktop —
	// the webview's own video path stays out of the picture entirely.
	const nativeStream = new NativePreviewStream();
	const nativeAudio = new NativeAudioPlayer();
	let nativeAudioActive = false;
	/** Which window of the base clip's audio is playing, if any. */
	let audioWindow: number | null = null;
	let nativeActive = false;
	let lastNativeBitmap: ImageBitmap | null = null;
	let nativeScrubToken = 0;

	/**
	 * Frames for every layer above the base clip.
	 *
	 * Decoded by the bundled ffmpeg, the same way the base is. Overlays are
	 * drawn small, so 640px wide is more than the canvas can show.
	 */
	const overlayFrames = new OverlayFrameCache(nativeFrameAt);
	const OVERLAY_DECODE_WIDTH = 640;

	/**
	 * One player per audio-track clip currently sounding.
	 *
	 * The export mixes every audio track into the render; the preview used to
	 * play only the base clip, so a music bed was in the file and not in the
	 * editor. Each bed clip gets its own player because they overlap by
	 * design — that is what a bed is.
	 */
	const bedPlayers = new Map<string, { player: NativeAudioPlayer; window: number }>();

	/**
	 * Starts and stops bed players to match the playhead.
	 *
	 * Clips already sounding are left running: restarting one every frame
	 * would stutter the music it exists to play.
	 */
	async function syncAudioBed(): Promise<void> {
		if (!ffmpeg || !playback.playing) return;

		const wanted = audioBedClips(timeline.tracks, playback.currentTime);
		const { start, stop } = diffBed(bedPlayers.keys(), wanted);

		for (const clipId of stop) {
			bedPlayers.get(clipId)?.player.stop();
			bedPlayers.delete(clipId);
		}

		// A bed clip that has run off the end of its window needs the next one,
		// exactly as the base clip does.
		for (const bed of wanted) {
			const entry = bedPlayers.get(bed.clip.id);
			if (!entry) continue;
			const at = bedSourceTime(bed.clip, playback.currentTime);
			if (windowIndexFor(at) !== entry.window) {
				entry.player.stop();
				bedPlayers.delete(bed.clip.id);
				start.push(bed);
			}
		}

		for (const bed of start) {
			const scratchName = nativeScratchName(bed.clip);
			const asset = mediaLibrary.getAssetById(bed.clip.assetId);
			if (!scratchName || !asset) continue;

			const at = bedSourceTime(bed.clip, playback.currentTime);
			const index = windowIndexFor(at);

			// Claim the slot before awaiting, so a second pass through the
			// loop does not start the same clip twice.
			const player = new NativeAudioPlayer();
			const entry = { player, window: index };
			bedPlayers.set(bed.clip.id, entry);

			const buffer = await loadAudioWindow(
				ffmpeg, asset.id, scratchName, windowStart(index), WINDOW_SECONDS
			);
			// The playhead may have left this clip while the decode ran.
			if (!buffer || bedPlayers.get(bed.clip.id) !== entry || !playback.playing) {
				bedPlayers.delete(bed.clip.id);
				continue;
			}

			player.start(
				buffer,
				offsetInWindow(at, index),
				bed.clip.speed * playback.playbackRate,
				bed.volume * playback.outputVolume
			);
		}
	}

	function stopAudioBed(): void {
		for (const entry of bedPlayers.values()) entry.player.stop();
		bedPlayers.clear();
	}

	/** Whether the selected clip has any mosaic to drag, so the layer can arm. */
	const hasMosaicRegions = $derived.by(() => {
		for (const id of selection.selectedClipIds) {
			const found = timeline.getClipById(id);
			if (found?.mosaics?.length) return true;
		}
		return false;
	});

	function nativeScratchName(clip: Clip): string | null {
		if (!isDesktop()) return null;
		const asset = mediaLibrary.getAssetById(clip.assetId);
		return asset?.scratchName ?? null;
	}

	async function startNative(clip: Clip): Promise<void> {
		const name = nativeScratchName(clip);
		// A still has one frame; the overlay canvas draws it. Running an
		// MJPEG stream for it would decode the same picture 30 times a second.
		if (clip.type === 'image') {
			await stopNative();
			return;
		}
		if (!name || clip.reversed) {
			await stopNative();
			return;
		}
		nativeActive = true;
		const sourceTime = getSourceTime(clip, playback.currentTime);
		const width = Math.min(1280, Math.max(320, chromaCanvas?.width || 960));
		await nativeStream.start(name, sourceTime, 30, width).catch(() => {
			nativeActive = false;
		});
	}

	/**
	 * Starts preview audio from ffmpeg-extracted PCM.
	 *
	 * The media element is muted whenever this succeeds: it is the same element
	 * that wedges at readyState 0 on this hardware, so nothing is left
	 * depending on it.
	 */
	async function startNativeAudio(clip: Clip): Promise<void> {
		nativeAudio.stop();
		nativeAudioActive = false;
		audioWindow = null;
		if (!ffmpeg || clip.reversed) return;

		const name = nativeScratchName(clip);
		const asset = mediaLibrary.getAssetById(clip.assetId);
		if (!name || !asset) return;

		// One window, not the whole clip. Decoding a 50-minute source whole
		// produced a 536 MB WAV and a 1.07 GB float buffer, and the process
		// was killed before a single sample played.
		const sourceTime = getSourceTime(clip, playback.currentTime);
		const index = windowIndexFor(sourceTime);
		const buffer = await loadAudioWindow(
			ffmpeg, asset.id, name, windowStart(index), WINDOW_SECONDS
		);
		if (!buffer) return;
		// The clip may have moved on while the extraction ran.
		if (!playback.playing || findActiveClip()?.id !== clip.id) return;

		if (videoEl) videoEl.muted = true;
		nativeAudioActive = true;
		audioWindow = index;
		nativeAudio.start(
			buffer,
			offsetInWindow(sourceTime, index),
			clip.speed * playback.playbackRate,
			getClipVolume(clip)
		);
	}

	/** Where the base clip's audio has reached in the source, across windows. */
	function nativeAudioPosition(): number {
		if (audioWindow === null) return 0;
		return windowStart(audioWindow) + nativeAudio.position();
	}

	/**
	 * Keeps the base clip's audio on the right window.
	 *
	 * Crossing a boundary restarts the player on the next window, and the one
	 * after that is fetched a few seconds early so the join is not audible.
	 */
	function advanceAudioWindow(clip: Clip): void {
		if (!ffmpeg || audioWindow === null) return;

		const name = nativeScratchName(clip);
		const asset = mediaLibrary.getAssetById(clip.assetId);
		if (!name || !asset) return;

		const sourceTime = getSourceTime(clip, playback.currentTime);

		if (windowIndexFor(sourceTime) !== audioWindow) {
			void startNativeAudio(clip);
			return;
		}

		const ahead = windowToPrefetch(sourceTime, clip.sourceEnd);
		if (ahead !== null) {
			// Deliberately not awaited: this runs inside the frame loop, and
			// the result is only wanted by the time the playhead gets there.
			void loadAudioWindow(ffmpeg, asset.id, name, windowStart(ahead), WINDOW_SECONDS);
		}
	}

	function stopNativeAudio(): void {
		nativeAudio.stop();
		nativeAudioActive = false;
		audioWindow = null;
	}

	async function stopNative(): Promise<void> {
		stopNativeAudio();
		nativeActive = false;
		lastNativeBitmap?.close();
		lastNativeBitmap = null;
		await nativeStream.stop();
	}

	/** Paints the newest decoded frame at or before the playback clock. */
	function paintNative(clip: Clip): void {
		const target = getSourceTime(clip, playback.currentTime);
		const frame = nativeStream.takeFrameFor(target);
		if (frame) {
			lastNativeBitmap?.close();
			lastNativeBitmap = frame.bitmap;
		}
		if (lastNativeBitmap) {
			paintSource(lastNativeBitmap, lastNativeBitmap.width, lastNativeBitmap.height, clip);
		}
	}

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
		resizeChromaCanvas();

		// The canvas only shows what was last painted, so a seek performed while
		// paused needs an explicit repaint — otherwise scrubbing leaves a stale
		// frame on screen even though the video decoded a new one.
		videoEl?.addEventListener('seeked', processChromaKeyFrame);
		videoEl?.addEventListener('loadeddata', processChromaKeyFrame);

		const resizeObserver = new ResizeObserver(() => {
			resizeChromaCanvas();
			processChromaKeyFrame();
		});
		if (viewportEl) resizeObserver.observe(viewportEl);

		return () => {
			resizeObserver.disconnect();
			videoEl?.removeEventListener('seeked', processChromaKeyFrame);
			videoEl?.removeEventListener('loadeddata', processChromaKeyFrame);
		};
	});

	onDestroy(() => {
		stopLoop();
		videoEl?.pause();
		void stopNative();
		stopAudioBed();
		overlayFrames.clear();
		// AudioBuffers are not small; holding them past the session is how the
		// process grows without ever looking like a leak.
		clearAudioCache();
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
		// The master level multiplies the mix rather than replacing it, so
		// muting does not lose the per-track balance underneath it.
		const mix = (track?.volume ?? 1) * clip.volume * playback.outputVolume;
		return Math.max(0, Math.min(1, mix));
	}

	// Muting has to take effect on the clip that is already playing, not on
	// the next one: the whole point of the shortcut is to silence what is
	// audible right now.
	$effect(() => {
		const level = playback.outputVolume;

		// Untracked: this effect exists to respond to the master level
		// changing, not to run sixty times a second because the playhead
		// moved. Reading the clock reactively here would make it do both.
		untrack(() => {
			// Bed players carry the master level too, or muting would silence
			// the base clip and leave the music playing.
			for (const bed of audioBedClips(timeline.tracks, playback.currentTime)) {
				bedPlayers.get(bed.clip.id)?.player.setVolume(bed.volume * level);
			}

			const clip = findActiveClip();
			if (!clip) return;

			const target = getClipVolume(clip);
			if (nativeAudioActive) nativeAudio.setVolume(target);
			else if (videoEl) videoEl.volume = target;
		});
	});

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

		// A still has no video stream. Loading its blob into the element only
		// produces a decode error, and leaving the previous clip's src in
		// place would show that frame around the edges of a letterboxed
		// image. The overlay canvas is what draws it.
		if (clip.type === 'image') {
			if (activeAssetId !== null) {
				videoEl.pause();
				videoEl.removeAttribute('src');
				videoEl.load();
				activeAssetId = null;
			}
			activeClipId = clip.id;
			return true;
		}

		// Only change src if different asset
		if (activeAssetId !== clip.assetId) {
			videoEl.src = asset.blobUrl;
			activeAssetId = clip.assetId;
		}
		activeClipId = clip.id;

		// Order matters. applyVideoTransforms assigns style.transform outright
		// and applyChromaKeyEffect assigns style.opacity, so both have to run
		// before applyVideoFilters, which appends the effect and keyframe
		// contributions on top. Running filters first meant Motion FX
		// transforms were overwritten a line later and never appeared.
		applyVideoTransforms(clip);
		applyChromaKeyEffect(clip);
		applyVideoFilters(clip);
		applyVideoPosition(clip);

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
			if (effectCss.transform && chromaCanvas) {
				const existingTransform = chromaCanvas.style.transform || '';
				chromaCanvas.style.transform = existingTransform ? `${existingTransform} ${effectCss.transform}` : effectCss.transform;
			}
		}

		// Keyframes are evaluated against time within the clip, which is what
		// FFmpeg's `t` means after the export chain trims and resets PTS.
		const keyframeCss = buildKeyframeCss(clip, playback.currentTime - clip.timelineStart);
		if (keyframeCss.filter) {
			filterStr = filterStr === 'none' ? keyframeCss.filter : `${filterStr} ${keyframeCss.filter}`;
		}
		if (keyframeCss.transform && chromaCanvas) {
			const existing = chromaCanvas.style.transform || '';
			chromaCanvas.style.transform = existing ? `${existing} ${keyframeCss.transform}` : keyframeCss.transform;
		}
		// Opacity goes on the canvas: the video element is permanently hidden
		// because the canvas is what the user actually sees.
		if (keyframeCss.opacity && chromaCanvas) {
			chromaCanvas.style.opacity = keyframeCss.opacity;
		} else if (chromaCanvas) {
			chromaCanvas.style.opacity = '';
		}
		if (keyframeCss.volume !== null) {
			videoEl.volume = Math.min(keyframeCss.volume, 1);
		}

		if (chromaCanvas) chromaCanvas.style.filter = filterStr === 'none' ? '' : filterStr;
	}

	/**
	 * The canvas is always the visible surface; the video element only decodes.
	 *
	 * Letting the webview composite a <video> is unreliable on Linux: with
	 * hybrid graphics WebKitGTK's DMABuf renderer paints the video region solid
	 * black while the rest of the page draws fine, and disabling DMABuf to work
	 * around it falls back to software compositing that is far too slow to edit
	 * against. Decoding is unaffected either way — `drawImage` returns correct
	 * pixels even when the element itself shows black, which is why thumbnails
	 * kept working — so the frames are copied to a canvas we control.
	 */
	function applyChromaKeyEffect(clip: Clip): void {
		if (!videoEl || !chromaCanvas) return;

		chromaKeyActive = clip.chromaKey?.enabled ?? false;

		chromaCanvas.style.display = 'block';
		// Kept in the layout (not display:none) so it continues to decode.
		videoEl.style.opacity = '0';
	}

	/**
	 * Copies the current decoded frame onto the display canvas.
	 *
	 * Runs every animation frame, so it is kept cheap: `willReadFrequently` is
	 * only requested when chroma keying actually needs `getImageData`, since
	 * that hint forces a software-backed canvas and makes the common case
	 * noticeably slower.
	 */
	/** Draws any frame source onto the display canvas with object-fit. */
	function paintSource(
		source: CanvasImageSource,
		sourceWidth: number,
		sourceHeight: number,
		clip: Clip | null
	): void {
		if (!chromaCanvas || sourceWidth === 0 || sourceHeight === 0) return;
		const ctx = chromaCanvas.getContext('2d', { willReadFrequently: chromaKeyActive });
		if (!ctx) return;

		const w = chromaCanvas.width;
		const h = chromaCanvas.height;
		if (w === 0 || h === 0) return;

		// Reproduce the CSS object-fit the <video> used to apply itself.
		const scale =
			ui.previewFillMode === 'fill'
				? Math.max(w / sourceWidth, h / sourceHeight)
				: Math.min(w / sourceWidth, h / sourceHeight);
		const drawW = sourceWidth * scale;
		const drawH = sourceHeight * scale;
		const dx = (w - drawW) / 2;
		const dy = (h - drawH) / 2;

		ctx.clearRect(0, 0, w, h);
		ctx.drawImage(source, dx, dy, drawW, drawH);

		if (!chromaKeyActive || !clip?.chromaKey?.enabled) return;
		const imageData = ctx.getImageData(0, 0, w, h);
		applyChromaKey(imageData, clip.chromaKey);
		ctx.putImageData(imageData, 0, 0);
	}

	function processChromaKeyFrame(): void {
		// Native mode owns the canvas; painting the (possibly wedged or black)
		// video element over ffmpeg's frames would reintroduce every webview
		// bug this path exists to escape.
		if (nativeActive) return;
		if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
		paintSource(videoEl, videoEl.videoWidth, videoEl.videoHeight, findActiveClip());
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

		if (!chromaCanvas) return;
		chromaCanvas.style.transform = parts.length > 0 ? parts.join(' ') : '';

		// Crop via clip-path (inset)
		const crop = clip.crop;
		if (crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0)) {
			chromaCanvas.style.clipPath = `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`;
		} else {
			chromaCanvas.style.clipPath = '';
		}
	}

	function applyVideoPosition(clip: Clip): void {
		if (!chromaCanvas) return;
		const pos = clip.position ?? DEFAULT_CLIP_POSITION;

		if (hasNonDefaultPosition(pos)) {
			chromaCanvas.style.left = `${pos.x}%`;
			chromaCanvas.style.top = `${pos.y}%`;
			chromaCanvas.style.width = `${pos.width}%`;
			chromaCanvas.style.height = `${pos.height}%`;
			chromaCanvas.style.zIndex = String(pos.zIndex);
			chromaCanvas.style.inset = 'auto';
		} else {
			chromaCanvas.style.left = '';
			chromaCanvas.style.top = '';
			chromaCanvas.style.width = '100%';
			chromaCanvas.style.height = '100%';
			chromaCanvas.style.zIndex = '';
			chromaCanvas.style.inset = '0';
		}
	}

	// ── Play/Pause called DIRECTLY from click handler ───────────────
	// This runs in user gesture context — browser MUST allow audio.

	function handlePlayClick() {
		if (playback.playing) {
			// Currently playing → will pause
			stopLoop();
			videoEl?.pause();
			void stopNative();
			stopAudioBed();
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
			videoEl.play().catch((err) => {
				console.warn('[preview] play failed:', err.name, err.message);
			});
		}

		// Start the RAF loop for timeline time advancement
		startLoop();
		void startNative(clip);
		void startNativeAudio(clip);
		void syncAudioBed();
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

		// Audio tracks run independently of the base clip's boundaries, so the
		// bed is reconciled every frame rather than only on a clip change.
		void syncAudioBed();

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
				videoEl.muted = nativeAudioActive;
				if (clip.reversed) {
					// Reversed: pause video, seek manually each frame
					videoEl.pause();
				} else {
					videoEl.playbackRate = clip.speed * playback.playbackRate;
					videoEl.play().catch(() => {});
				}
				// Each clip gets its own decode stream from its own source time.
				void startNative(clip);
				void startNativeAudio(clip);
			} else {
				videoEl?.pause();
				void stopNative();
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

		// 4b. Keep ffmpeg-decoded audio locked to the timeline clock.
		if (nativeAudioActive && clip && !clipChanged) {
			const expectedAudio = getSourceTime(clip, playback.currentTime);
			if (Math.abs(nativeAudioPosition() - expectedAudio) > 0.3) {
				void startNativeAudio(clip);
			} else {
				nativeAudio.setVolume(getClipVolume(clip));
				advanceAudioWindow(clip);
			}
		}

		// 5. Frame paint: ffmpeg-decoded frames when available, else the
		// video element (web builds, or assets without a scratch copy).
		if (nativeActive && clip) {
			paintNative(clip);
		} else {
			processChromaKeyFrame();
		}

		// 6. Text overlays paint above the frame.
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
					void startNative(clip);
					void startNativeAudio(clip);
				}
			}
		} else {
			stopLoop();
			videoEl.pause();
			void stopNative();
			stopAudioBed();
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

					// Native scrub: decode exactly the frame under the playhead.
					// The token discards stale responses when scrubbing fast.
					const name = nativeScratchName(clip);
					if (name) {
						nativeActive = true;
						const token = ++nativeScrubToken;
						const width = Math.min(1280, Math.max(320, chromaCanvas?.width || 960));
						void nativeFrameAt(name, sourceTime, width).then((bitmap) => {
							if (!bitmap) return;
							if (token !== nativeScrubToken) {
								bitmap.close();
								return;
							}
							lastNativeBitmap?.close();
							lastNativeBitmap = bitmap;
							paintSource(bitmap, bitmap.width, bitmap.height, clip);
							drawTextOverlays();
						});
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

	/** Paints one composited layer, if a frame for it is available yet. */
	function drawLayer(
		ctx: CanvasRenderingContext2D,
		layer: PreviewLayer,
		frameWidth: number,
		frameHeight: number
	): void {
		const scratchName = nativeScratchName(layer.clip);
		if (!scratchName) return;

		const frame = overlayFrames.get(
			{
				clip: layer.clip,
				scratchName,
				sourceTime: getSourceTime(layer.clip, playback.currentTime),
				width: OVERLAY_DECODE_WIDTH,
				still: layer.clip.type === 'image',
			},
			// The decode lands after this paint; repaint so it is not held
			// back until the next frame the playhead happens to need.
			() => drawTextOverlays()
		);
		if (!frame) return;

		const rect = layerRect(layer.clip, frameWidth, frameHeight, frame.width, frame.height);
		const previous = ctx.globalAlpha;
		ctx.globalAlpha = layer.opacity;
		ctx.drawImage(frame, rect.x, rect.y, rect.width, rect.height);
		ctx.globalAlpha = previous;
	}

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

	/**
	 * Draws every layer above the base clip, then the text and shape overlays.
	 *
	 * The base clip is painted by the video element and the native stream
	 * underneath this canvas; anything on a higher video track is drawn here,
	 * in the same order and the same geometry the export composites it. A
	 * still image on the base track is drawn here too — the video element
	 * cannot show one, which is why an image on the timeline used to preview
	 * as nothing at all.
	 */
	function drawTextOverlays() {
		if (!overlayCanvas) return;
		const ctx = overlayCanvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

		const w = overlayCanvas.width / dpr;
		const h = overlayCanvas.height / dpr;

		const layers = visibleLayers(timeline.tracks, playback.currentTime);
		const base = baseLayer(layers);
		const toDraw = overlayLayers(layers);
		// The video element shows video; a still on the base track has nothing
		// showing it, so it is drawn here as well.
		if (base && base.clip.type === 'image') toDraw.unshift(base);

		if (toDraw.length > 0) {
			ctx.save();
			ctx.scale(dpr, dpr);
			for (const layer of toDraw) drawLayer(ctx, layer, w, h);
			ctx.restore();
		}

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
			<!--
				preload must stay "metadata". With "auto" WebKitGTK tries to pull
				the entire blob into the GStreamer pipeline, and once a couple of
				large clips are loaded the element intermittently wedges at
				readyState 0 / networkState 2 — no error, no metadata, just a
				permanently black preview. Measured on a 27MB clip: "auto"
				stalled on the second load, "metadata" loaded every time in
				~300ms. The player seeks explicitly anyway, so buffering ahead
				buys nothing.
			-->
			<video
				bind:this={videoEl}
				playsinline
				preload="metadata"
				class="preview-video"
				style="object-fit: {ui.previewFillMode === 'fill' ? 'cover' : 'contain'};"
			></video>
			<canvas class="chroma-key-canvas" bind:this={chromaCanvas} style="display: none;"></canvas>
			<canvas class="text-overlay" bind:this={overlayCanvas}></canvas>
			<!-- Sits above the frame and the overlays; ignores pointer events
			     entirely until a drawing tool is armed in the panel. -->
			<!-- Under the annotation layer, and inert unless the properties
			     panel is open on a clip that actually has regions — otherwise
			     it would sit over the frame catching clicks for nothing. -->
			<MosaicLayer active={ui.activePanel === 'properties' && hasMosaicRegions} />
			<AnnotationLayer
				tools={ui.annotationTools}
				onselect={(id) => (ui.selectedAnnotationId = id)}
			/>
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
