<script lang="ts">
	interface Props {
		src: string;
		fallbackSrc?: string;
		poster?: string;
	}

	let { src, fallbackSrc, poster }: Props = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();
	let hlsInstance: any = $state(null);

	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let isFullscreen = $state(false);
	let showControls = $state(true);
	let controlsTimer: ReturnType<typeof setTimeout> | null = null;

	// Determine which source mode we're using:
	// - 'hls' when an HLS URL is available
	// - 'fallback' when only the raw source video is available
	// - 'none' when neither is available
	let sourceMode = $derived<'hls' | 'fallback' | 'none'>(
		src ? 'hls' : fallbackSrc ? 'fallback' : 'none'
	);

	$effect(() => {
		if (!videoEl) return;
		const currentSrc = src;
		const currentFallback = fallbackSrc;

		if (currentSrc) {
			loadHlsSource(currentSrc);
		} else if (currentFallback) {
			loadDirectSource(currentFallback);
		}

		return () => {
			destroyHls();
		};
	});

	function loadDirectSource(url: string) {
		destroyHls();
		if (!videoEl) return;
		videoEl.src = url;
	}

	async function loadHlsSource(url: string) {
		destroyHls();
		if (!videoEl) return;

		// Check for native HLS support (Safari)
		if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
			videoEl.src = url;
			return;
		}

		try {
			const HlsModule = await import('hls.js');
			const Hls = HlsModule.default;
			if (!Hls.isSupported()) {
				// Fallback: try direct src
				videoEl.src = url;
				return;
			}
			const hls = new Hls();
			hls.loadSource(url);
			hls.attachMedia(videoEl);
			hlsInstance = hls;
		} catch {
			// If hls.js import fails, try direct
			if (videoEl) videoEl.src = url;
		}
	}

	function destroyHls() {
		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}
	}

	function togglePlay() {
		if (!videoEl) return;
		if (videoEl.paused) {
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function handleTimeUpdate() {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		duration = videoEl.duration || 0;
	}

	function handlePlay() { playing = true; }
	function handlePause() { playing = false; }

	function handleSeek(e: MouseEvent) {
		if (!videoEl || !duration) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		videoEl.currentTime = ratio * duration;
	}

	function handleVolumeChange(e: Event) {
		if (!videoEl) return;
		const val = parseFloat((e.target as HTMLInputElement).value);
		volume = val;
		videoEl.volume = val;
		muted = val === 0;
	}

	function toggleMute() {
		if (!videoEl) return;
		muted = !muted;
		videoEl.muted = muted;
	}

	function toggleFullscreen() {
		if (!containerEl) return;
		if (!document.fullscreenElement) {
			containerEl.requestFullscreen();
		} else {
			document.exitFullscreen();
		}
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
	}

	function handleMouseMove() {
		showControls = true;
		if (controlsTimer) clearTimeout(controlsTimer);
		controlsTimer = setTimeout(() => {
			if (playing) showControls = false;
		}, 3000);
	}

	function formatTime(secs: number): string {
		if (!isFinite(secs)) return '0:00';
		const m = Math.floor(secs / 60);
		const s = Math.floor(secs % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	let progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
</script>

<svelte:document onfullscreenchange={handleFullscreenChange} />

<div
	class="hls-player"
	class:fullscreen={isFullscreen}
	bind:this={containerEl}
	onmousemove={handleMouseMove}
	onmouseleave={() => { if (playing) showControls = false; }}
	role="region"
	aria-label="Video player"
>
	<video
		bind:this={videoEl}
		{poster}
		playsinline
		onclick={togglePlay}
		ontimeupdate={handleTimeUpdate}
		onplay={handlePlay}
		onpause={handlePause}
		onloadedmetadata={handleTimeUpdate}
		class="video-element"
	></video>

	{#if sourceMode === 'fallback'}
		<div class="processing-badge">
			<div class="processing-dot"></div>
			HD processing...
		</div>
	{/if}

	{#if sourceMode === 'none'}
		<div class="no-source-overlay">
			<div class="spinner"></div>
			<p>Video is being processed...</p>
		</div>
	{/if}

	{#if !playing && currentTime === 0 && sourceMode !== 'none'}
		<button class="big-play-btn" onclick={togglePlay} aria-label="Play video">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
		</button>
	{/if}

	<div class="controls" class:visible={showControls || !playing}>
		<div class="progress-bar" onclick={handleSeek} role="slider" tabindex="0" aria-label="Seek" aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}>
			<div class="progress-track">
				<div class="progress-fill" style="width: {progress}%"></div>
			</div>
		</div>

		<div class="controls-row">
			<div class="controls-left">
				<button class="ctrl-btn" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
					{#if playing}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
					{:else}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
					{/if}
				</button>

				<button class="ctrl-btn" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
					{#if muted || volume === 0}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
					{:else}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
					{/if}
				</button>

				<input
					type="range"
					class="volume-slider"
					min="0"
					max="1"
					step="0.05"
					value={muted ? 0 : volume}
					oninput={handleVolumeChange}
					aria-label="Volume"
				/>

				<span class="time-display">
					{formatTime(currentTime)} / {formatTime(duration)}
				</span>
			</div>

			<div class="controls-right">
				<button class="ctrl-btn" onclick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
						{#if isFullscreen}
							<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
						{:else}
							<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
						{/if}
					</svg>
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.hls-player {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: black;
		border-radius: 12px;
		overflow: hidden;
		cursor: pointer;
	}
	.hls-player.fullscreen {
		border-radius: 0;
	}
	.video-element {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.big-play-btn {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.6);
		border: 2px solid rgba(255, 255, 255, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: var(--transition-fast);
	}
	.big-play-btn:hover {
		background: rgba(0, 0, 0, 0.8);
		border-color: rgba(255, 255, 255, 0.5);
	}
	.processing-badge {
		position: absolute;
		top: 12px;
		right: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 20px;
		color: rgba(255, 255, 255, 0.85);
		font-size: 12px;
		font-weight: 500;
		pointer-events: none;
		z-index: 5;
	}
	.processing-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #f59e0b;
		animation: pulse-dot 1.5s ease-in-out infinite;
	}
	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
	.no-source-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: rgba(0, 0, 0, 0.6);
		z-index: 5;
	}
	.no-source-overlay p {
		color: rgba(255, 255, 255, 0.7);
		font-size: 14px;
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(255, 255, 255, 0.1);
		border-top-color: #ff3333;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.controls {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
		padding: 24px 12px 12px;
		opacity: 0;
		transition: opacity 0.2s;
	}
	.controls.visible {
		opacity: 1;
	}
	.progress-bar {
		width: 100%;
		padding: 4px 0;
		cursor: pointer;
		margin-bottom: 8px;
	}
	.progress-track {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: white;
		border-radius: 2px;
		transition: width 0.1s linear;
	}
	.progress-bar:hover .progress-track {
		height: 6px;
	}
	.controls-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.controls-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.controls-right {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.ctrl-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: white;
		cursor: pointer;
		border-radius: 4px;
	}
	.ctrl-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}
	.volume-slider {
		width: 60px;
		height: 4px;
		accent-color: white;
		cursor: pointer;
	}
	.time-display {
		font-size: 12px;
		color: rgba(255, 255, 255, 0.8);
		font-family: var(--font-mono);
		white-space: nowrap;
	}
</style>
