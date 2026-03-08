<script lang="ts">
	import { getRecorder } from '$lib/state/context.js';
	import type { RecordingMode, RecordingQuality } from '$lib/types/recorder.js';
	import { onMount, onDestroy } from 'svelte';

	let { onstart }: { onstart: () => void } = $props();
	const recorder = getRecorder();

	let cameraPreviewEl: HTMLVideoElement | undefined = $state();
	let cameraPreviewStream: MediaStream | null = $state(null);
	let mounted = $state(false);
	let cameraDropdownOpen = $state(false);
	let micDropdownOpen = $state(false);

	const modes: { value: RecordingMode; label: string; description: string }[] = [
		{ value: 'screen-cam', label: 'Screen + Camera', description: 'Record your screen with camera overlay' },
		{ value: 'screen-only', label: 'Screen Only', description: 'Capture your entire screen' },
		{ value: 'camera-only', label: 'Camera Only', description: 'Record from your webcam' },
	];

	const qualities: RecordingQuality[] = ['1080p', '720p', '480p'];

	let showCameraPreview = $derived(recorder.mode !== 'screen-only');

	let selectedCameraLabel = $derived(
		recorder.cameras.find(c => c.deviceId === recorder.selectedCameraId)?.label ?? 'Select camera'
	);

	let selectedMicLabel = $derived(
		recorder.microphones.find(m => m.deviceId === recorder.selectedMicId)?.label ?? 'Select microphone'
	);

	onMount(() => {
		mounted = true;
	});

	$effect(() => {
		if (showCameraPreview && recorder.selectedCameraId && cameraPreviewEl) {
			startCameraPreview(recorder.selectedCameraId);
		} else {
			stopCameraPreview();
		}
	});

	async function startCameraPreview(deviceId: string) {
		stopCameraPreview();
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { deviceId: { exact: deviceId }, width: 480, height: 480 }
			});
			cameraPreviewStream = stream;
			if (cameraPreviewEl) {
				cameraPreviewEl.srcObject = stream;
			}
		} catch {
			// Camera might not be available
		}
	}

	function stopCameraPreview() {
		if (cameraPreviewStream) {
			cameraPreviewStream.getTracks().forEach(t => t.stop());
			cameraPreviewStream = null;
		}
		if (cameraPreviewEl) {
			cameraPreviewEl.srcObject = null;
		}
	}

	onDestroy(() => {
		stopCameraPreview();
	});

	function selectCamera(deviceId: string) {
		recorder.selectedCameraId = deviceId;
		cameraDropdownOpen = false;
	}

	function selectMic(deviceId: string) {
		recorder.selectedMicId = deviceId;
		micDropdownOpen = false;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.custom-select')) {
			cameraDropdownOpen = false;
			micDropdownOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="pre-record" class:mounted>
	<div class="bg-gradient"></div>
	<div class="content">
		<!-- Logo -->
		<div class="logo">
			<svg width="32" height="32" viewBox="0 0 32 32" fill="none">
				<rect width="32" height="32" rx="8" fill="#ff3333"/>
				<path d="M10 8v16l14-8z" fill="white"/>
			</svg>
			<span class="logo-text">DITTOO</span>
		</div>

		<!-- Heading -->
		<div class="header">
			<h1 class="title">Record a video</h1>
			<p class="subtitle">Choose your recording mode and configure your devices</p>
		</div>

		<!-- Camera preview -->
		{#if showCameraPreview}
			<div class="camera-preview-container">
				<div class="camera-preview-ring">
					<div class="camera-preview-circle">
						{#if cameraPreviewStream}
							<video
								bind:this={cameraPreviewEl}
								autoplay
								playsinline
								muted
								class="camera-preview-video"
							></video>
						{:else}
							<div class="camera-preview-placeholder">
								<svg width="48" height="48" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)">
									<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
								</svg>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- Mode Selection -->
		<div class="section">
			<div class="mode-grid">
				{#each modes as mode}
					<button
						class="mode-card"
						class:active={recorder.mode === mode.value}
						onclick={() => recorder.setMode(mode.value)}
					>
						<div class="mode-icon-wrapper">
							{#if mode.value === 'screen-cam'}
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
									<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
									<line x1="8" y1="21" x2="16" y2="21"/>
									<line x1="12" y1="17" x2="12" y2="21"/>
									<circle cx="18" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
									<circle cx="18" cy="15" r="1.5" fill="currentColor" stroke="none"/>
								</svg>
							{:else if mode.value === 'screen-only'}
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
									<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
									<line x1="8" y1="21" x2="16" y2="21"/>
									<line x1="12" y1="17" x2="12" y2="21"/>
								</svg>
							{:else}
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
									<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
									<circle cx="12" cy="13" r="4"/>
								</svg>
							{/if}
						</div>
						<span class="mode-title">{mode.label}</span>
						<span class="mode-desc">{mode.description}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Device selectors -->
		<div class="device-selectors">
			{#if recorder.mode !== 'screen-only'}
				<div class="section">
					<label class="label">Camera</label>
					<div class="custom-select" class:open={cameraDropdownOpen}>
						<button
							class="select-trigger"
							onclick={(e) => { e.stopPropagation(); cameraDropdownOpen = !cameraDropdownOpen; micDropdownOpen = false; }}
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="select-icon">
								<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
							</svg>
							<span class="select-label">{selectedCameraLabel}</span>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" class="select-chevron">
								<path d="M7 10l5 5 5-5z"/>
							</svg>
						</button>
						{#if cameraDropdownOpen}
							<div class="select-dropdown">
								{#each recorder.cameras as cam}
									<button
										class="select-option"
										class:selected={recorder.selectedCameraId === cam.deviceId}
										onclick={(e) => { e.stopPropagation(); selectCamera(cam.deviceId); }}
									>
										{cam.label}
										{#if recorder.selectedCameraId === cam.deviceId}
											<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
												<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
											</svg>
										{/if}
									</button>
								{/each}
								{#if recorder.cameras.length === 0}
									<div class="select-option disabled">No cameras found</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<div class="section">
				<label class="label">Microphone</label>
				<div class="custom-select" class:open={micDropdownOpen}>
					<button
						class="select-trigger"
						onclick={(e) => { e.stopPropagation(); micDropdownOpen = !micDropdownOpen; cameraDropdownOpen = false; }}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="select-icon">
							<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
						</svg>
						<span class="select-label">{selectedMicLabel}</span>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" class="select-chevron">
							<path d="M7 10l5 5 5-5z"/>
						</svg>
					</button>
					{#if micDropdownOpen}
						<div class="select-dropdown">
							{#each recorder.microphones as mic}
								<button
									class="select-option"
									class:selected={recorder.selectedMicId === mic.deviceId}
									onclick={(e) => { e.stopPropagation(); selectMic(mic.deviceId); }}
								>
									{mic.label}
									{#if recorder.selectedMicId === mic.deviceId}
										<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
											<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
										</svg>
									{/if}
								</button>
							{/each}
							{#if recorder.microphones.length === 0}
								<div class="select-option disabled">No microphones found</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Quality -->
		<div class="section">
			<label class="label">Quality</label>
			<div class="quality-group">
				{#each qualities as q}
					<button
						class="quality-pill"
						class:active={recorder.quality === q}
						onclick={() => recorder.quality = q}
					>
						{q}
					</button>
				{/each}
			</div>
		</div>

		<!-- Start button -->
		<button class="start-btn" onclick={onstart}>
			<span class="start-btn-inner">
				<span class="record-dot"></span>
				Start Recording
			</span>
		</button>
	</div>
</div>

<style>
	.pre-record {
		width: 100%;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		opacity: 0;
		transform: translateY(10px);
		transition: opacity 0.5s ease, transform 0.5s ease;
	}

	.pre-record.mounted {
		opacity: 1;
		transform: translateY(0);
	}

	.bg-gradient {
		position: fixed;
		inset: 0;
		background:
			radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 51, 51, 0.12), transparent),
			radial-gradient(ellipse 60% 40% at 80% 50%, rgba(120, 40, 200, 0.06), transparent),
			radial-gradient(ellipse 60% 40% at 20% 80%, rgba(51, 100, 255, 0.06), transparent);
		animation: gradientShift 12s ease-in-out infinite alternate;
		pointer-events: none;
	}

	@keyframes gradientShift {
		0% { opacity: 0.8; transform: scale(1); }
		50% { opacity: 1; transform: scale(1.05); }
		100% { opacity: 0.8; transform: scale(1); }
	}

	.content {
		position: relative;
		z-index: 1;
		width: 560px;
		max-width: 90vw;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 0;
	}

	/* Logo */
	.logo {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 40px;
	}

	.logo-text {
		font-size: 18px;
		font-weight: 700;
		letter-spacing: 2px;
		color: var(--text-primary);
	}

	/* Header */
	.header {
		text-align: center;
		margin-bottom: 36px;
	}

	.title {
		font-size: 36px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 8px;
		letter-spacing: -0.5px;
	}

	.subtitle {
		font-size: 15px;
		color: var(--text-secondary);
		font-weight: 400;
	}

	/* Camera Preview */
	.camera-preview-container {
		margin-bottom: 36px;
		display: flex;
		justify-content: center;
	}

	.camera-preview-ring {
		width: 244px;
		height: 244px;
		border-radius: 50%;
		padding: 2px;
		background: linear-gradient(135deg, #ff3333, #ff6b33, #ff3366);
		animation: ringRotate 4s linear infinite;
	}

	@keyframes ringRotate {
		0% { background: linear-gradient(0deg, #ff3333, #ff6b33, #ff3366); }
		25% { background: linear-gradient(90deg, #ff3333, #ff6b33, #ff3366); }
		50% { background: linear-gradient(180deg, #ff3333, #ff6b33, #ff3366); }
		75% { background: linear-gradient(270deg, #ff3333, #ff6b33, #ff3366); }
		100% { background: linear-gradient(360deg, #ff3333, #ff6b33, #ff3366); }
	}

	.camera-preview-circle {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		overflow: hidden;
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.camera-preview-video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transform: scaleX(-1);
	}

	.camera-preview-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	/* Mode cards */
	.section {
		width: 100%;
		margin-bottom: 20px;
	}

	.label {
		display: block;
		font-size: 12px;
		color: var(--text-tertiary);
		margin-bottom: 8px;
		text-transform: uppercase;
		letter-spacing: 0.8px;
		font-weight: 600;
	}

	.mode-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.mode-card {
		position: relative;
		padding: 24px 16px 20px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		cursor: pointer;
		text-align: center;
		transition: all 0.25s ease;
		color: var(--text-primary);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}

	.mode-card:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.15);
		transform: translateY(-2px);
	}

	.mode-card.active {
		background: rgba(255, 51, 51, 0.08);
		border-color: rgba(255, 51, 51, 0.5);
		box-shadow: 0 0 24px rgba(255, 51, 51, 0.15), inset 0 0 24px rgba(255, 51, 51, 0.05);
	}

	.mode-icon-wrapper {
		width: 52px;
		height: 52px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition: all 0.25s ease;
	}

	.mode-card.active .mode-icon-wrapper {
		background: rgba(255, 51, 51, 0.15);
		color: #ff5555;
	}

	.mode-card:hover .mode-icon-wrapper {
		color: var(--text-primary);
	}

	.mode-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.mode-desc {
		font-size: 11px;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	/* Device selectors */
	.device-selectors {
		width: 100%;
	}

	.custom-select {
		position: relative;
	}

	.select-trigger {
		width: 100%;
		padding: 10px 14px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 10px;
		transition: all 0.2s ease;
		text-align: left;
	}

	.select-trigger:hover {
		background: rgba(255, 255, 255, 0.07);
		border-color: rgba(255, 255, 255, 0.18);
	}

	.custom-select.open .select-trigger {
		border-color: rgba(255, 51, 51, 0.4);
		background: rgba(255, 255, 255, 0.06);
	}

	.select-icon {
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.select-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-chevron {
		color: var(--text-tertiary);
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.custom-select.open .select-chevron {
		transform: rotate(180deg);
	}

	.select-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		background: #1c1c1c;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		padding: 4px;
		z-index: 100;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		animation: dropdownIn 0.15s ease;
	}

	@keyframes dropdownIn {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.select-option {
		width: 100%;
		padding: 9px 12px;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
		display: flex;
		align-items: center;
		justify-content: space-between;
		transition: all 0.12s ease;
	}

	.select-option:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.select-option.selected {
		color: var(--text-primary);
	}

	.select-option.disabled {
		color: var(--text-tertiary);
		cursor: default;
	}

	/* Quality pills */
	.quality-group {
		display: flex;
		gap: 0;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		padding: 3px;
	}

	.quality-pill {
		flex: 1;
		padding: 8px 16px;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--text-tertiary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.quality-pill:hover {
		color: var(--text-secondary);
	}

	.quality-pill.active {
		background: rgba(255, 255, 255, 0.1);
		color: var(--text-primary);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	}

	/* Start button */
	.start-btn {
		width: 100%;
		margin-top: 28px;
		padding: 2px;
		background: linear-gradient(135deg, #ff3333, #ff5544);
		border: none;
		border-radius: 14px;
		cursor: pointer;
		transition: all 0.3s ease;
		animation: btnPulse 2.5s ease-in-out infinite;
	}

	.start-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 32px rgba(255, 51, 51, 0.3);
		animation: none;
	}

	.start-btn:active {
		transform: translateY(0);
	}

	.start-btn-inner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 16px 32px;
		border-radius: 12px;
		background: linear-gradient(135deg, #ff3333, #ff4444);
		color: white;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: 0.2px;
	}

	.record-dot {
		width: 10px;
		height: 10px;
		background: white;
		border-radius: 50%;
		flex-shrink: 0;
	}

	@keyframes btnPulse {
		0%, 100% { box-shadow: 0 4px 20px rgba(255, 51, 51, 0.2); }
		50% { box-shadow: 0 4px 32px rgba(255, 51, 51, 0.35); }
	}
</style>
