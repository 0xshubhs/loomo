<script lang="ts">
	import { getRecorder } from '$lib/state/context.js';
	import PreRecordPanel from './PreRecordPanel.svelte';
	import FloatingControls from './FloatingControls.svelte';
	import CountdownOverlay from './CountdownOverlay.svelte';
	import PostRecordPanel from './PostRecordPanel.svelte';
	import CameraBubble from './CameraBubble.svelte';
	import { RecordingSession } from '$lib/recorder/recording-session.js';
	import { onMount } from 'svelte';

	const recorder = getRecorder();
	let session: RecordingSession | null = null;

	let showCameraBubble = $derived(
		recorder.mode === 'screen-cam' &&
		(recorder.recordingState === 'recording' || recorder.recordingState === 'paused') &&
		recorder.cameraStream !== null
	);

	let currentView = $derived.by(() => {
		if (recorder.recordingState === 'idle' || recorder.recordingState === 'requesting-permissions') return 'pre';
		if (recorder.recordingState === 'countdown') return 'countdown';
		if (recorder.recordingState === 'recording' || recorder.recordingState === 'paused') return 'recording';
		if (recorder.recordingState === 'processing') return 'processing';
		if (recorder.recordingState === 'done' && recorder.result) return 'done';
		if (recorder.recordingState === 'error') return 'error';
		return 'pre';
	});

	onMount(() => {
		recorder.enumerateDevices();
	});

	async function handleStart() {
		session = new RecordingSession(recorder);
		try {
			await session.start();
		} catch (err) {
			console.error('Recording failed:', err);
		}
	}

	function handlePause() { session?.pause(); }
	function handleResume() { session?.resume(); }

	async function handleStop() {
		if (!session) return;
		await session.stop();
	}

	function handleRestart() {
		session?.cancel();
		session = null;
	}

	function handleReRecord() {
		recorder.reset();
		session = null;
	}
</script>

{#if showCameraBubble}
	<CameraBubble stream={recorder.cameraStream} />
{/if}

<div class="record-layout">
	<div class="layout-bg"></div>

	{#if currentView === 'pre'}
		<div class="view-container fade-in">
			<PreRecordPanel onstart={handleStart} />
		</div>
	{:else if currentView === 'countdown'}
		<CountdownOverlay value={recorder.countdownValue} />
	{:else if currentView === 'recording'}
		<FloatingControls
			isPaused={recorder.isPaused}
			elapsedTime={recorder.formattedTime}
			onpause={handlePause}
			onresume={handleResume}
			onstop={handleStop}
			onrestart={handleRestart}
		/>
	{:else if currentView === 'processing'}
		<div class="view-container fade-in">
			<div class="processing">
				<div class="spinner"></div>
				<p class="processing-text">Processing your recording...</p>
				<p class="processing-sub">This may take a moment</p>
			</div>
		</div>
	{:else if currentView === 'done'}
		<div class="view-container fade-in">
			<PostRecordPanel
				result={recorder.result!}
				onrerecord={handleReRecord}
			/>
		</div>
	{:else if currentView === 'error'}
		<div class="view-container fade-in">
			<div class="error-panel">
				<div class="error-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"/>
						<line x1="15" y1="9" x2="9" y2="15"/>
						<line x1="9" y1="9" x2="15" y2="15"/>
					</svg>
				</div>
				<h2 class="error-title">Recording Error</h2>
				<p class="error-msg">{recorder.error}</p>
				<button class="retry-btn" onclick={handleReRecord}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
					</svg>
					Try Again
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.record-layout {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-primary);
		position: relative;
		overflow: hidden;
	}

	.layout-bg {
		position: fixed;
		inset: 0;
		background: var(--bg-primary);
		z-index: -1;
	}

	.view-container {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.fade-in {
		animation: fadeSlideIn 0.4s ease forwards;
	}

	@keyframes fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Processing */
	.processing {
		text-align: center;
		padding: 48px;
	}

	.spinner {
		width: 44px;
		height: 44px;
		border: 3px solid rgba(255, 255, 255, 0.1);
		border-top-color: #ff3333;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto 20px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.processing-text {
		font-size: 18px;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 6px;
	}

	.processing-sub {
		font-size: 14px;
		color: var(--text-tertiary);
	}

	/* Error */
	.error-panel {
		text-align: center;
		padding: 48px;
		max-width: 400px;
	}

	.error-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: rgba(255, 68, 68, 0.1);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 20px;
	}

	.error-title {
		font-size: 20px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.error-msg {
		font-size: 14px;
		color: var(--text-secondary);
		margin-bottom: 28px;
		line-height: 1.5;
	}

	.retry-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 28px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.retry-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.2);
	}
</style>
