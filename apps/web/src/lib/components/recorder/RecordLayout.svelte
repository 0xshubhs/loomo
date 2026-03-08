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

	function handleDownload() {
		if (!recorder.result) return;
		const url = URL.createObjectURL(recorder.result.blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'recording.webm';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

{#if showCameraBubble}
	<CameraBubble stream={recorder.cameraStream} />
{/if}

<div class="record-layout">
	{#if recorder.recordingState === 'idle' || recorder.recordingState === 'requesting-permissions'}
		<PreRecordPanel onstart={handleStart} />
	{:else if recorder.recordingState === 'countdown'}
		<CountdownOverlay value={recorder.countdownValue} />
	{:else if recorder.recordingState === 'recording' || recorder.recordingState === 'paused'}
		<FloatingControls
			isPaused={recorder.isPaused}
			elapsedTime={recorder.formattedTime}
			onpause={handlePause}
			onresume={handleResume}
			onstop={handleStop}
			onrestart={handleRestart}
		/>
	{:else if recorder.recordingState === 'processing'}
		<div class="processing">
			<div class="spinner"></div>
			<p>Processing recording...</p>
		</div>
	{:else if recorder.recordingState === 'done' && recorder.result}
		<PostRecordPanel
			result={recorder.result}
			onrerecord={handleReRecord}
			ondownload={handleDownload}
		/>
	{:else if recorder.recordingState === 'error'}
		<div class="error-panel">
			<h2>Recording Error</h2>
			<p>{recorder.error}</p>
			<button class="retry-btn" onclick={handleReRecord}>Try Again</button>
		</div>
	{/if}
</div>

<style>
	.record-layout {
		min-height: 100vh;
		background: var(--bg-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-primary);
	}
	.processing, .error-panel {
		text-align: center;
		padding: 48px;
	}
	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--border-primary);
		border-top-color: var(--text-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto 16px;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.error-panel h2 { color: var(--danger); margin-bottom: 8px; }
	.error-panel p { color: var(--text-secondary); margin-bottom: 24px; }
	.retry-btn {
		padding: 10px 24px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		cursor: pointer;
	}
	.retry-btn:hover { background: var(--bg-hover); }
</style>
