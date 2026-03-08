<script lang="ts">
	import { getRecorder } from '$lib/state/context.js';
	import type { RecordingMode, RecordingQuality } from '$lib/types/recorder.js';

	let { onstart }: { onstart: () => void } = $props();
	const recorder = getRecorder();

	const modes: { value: RecordingMode; label: string; icon: string }[] = [
		{ value: 'screen-cam', label: 'Screen + Camera', icon: '🖥️ 📷' },
		{ value: 'screen-only', label: 'Screen Only', icon: '🖥️' },
		{ value: 'camera-only', label: 'Camera Only', icon: '📷' },
	];

	const qualities: RecordingQuality[] = ['1080p', '720p', '480p'];
</script>

<div class="pre-record">
	<h1 class="title">New Recording</h1>

	<div class="section">
		<label class="label">Recording Mode</label>
		<div class="mode-grid">
			{#each modes as mode}
				<button
					class="mode-card"
					class:active={recorder.mode === mode.value}
					onclick={() => recorder.setMode(mode.value)}
				>
					<span class="mode-icon">{mode.icon}</span>
					<span class="mode-label">{mode.label}</span>
				</button>
			{/each}
		</div>
	</div>

	{#if recorder.mode !== 'screen-only'}
		<div class="section">
			<label class="label">Camera</label>
			<select
				class="select"
				value={recorder.selectedCameraId ?? ''}
				onchange={(e) => recorder.selectedCameraId = (e.target as HTMLSelectElement).value || null}
			>
				<option value="">No camera</option>
				{#each recorder.cameras as cam}
					<option value={cam.deviceId}>{cam.label}</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="section">
		<label class="label">Microphone</label>
		<select
			class="select"
			value={recorder.selectedMicId ?? ''}
			onchange={(e) => recorder.selectedMicId = (e.target as HTMLSelectElement).value || null}
		>
			<option value="">No microphone</option>
			{#each recorder.microphones as mic}
				<option value={mic.deviceId}>{mic.label}</option>
			{/each}
		</select>
	</div>

	<div class="section">
		<label class="label">Quality</label>
		<div class="quality-group">
			{#each qualities as q}
				<button
					class="quality-btn"
					class:active={recorder.quality === q}
					onclick={() => recorder.quality = q}
				>
					{q}
				</button>
			{/each}
		</div>
	</div>

	<button class="start-btn" onclick={onstart}>
		<span class="record-dot"></span>
		Start Recording
	</button>
</div>

<style>
	.pre-record {
		width: 420px;
		padding: 40px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 12px;
	}
	.title {
		font-size: 24px;
		font-weight: 600;
		margin-bottom: 32px;
		text-align: center;
	}
	.section { margin-bottom: 20px; }
	.label {
		display: block;
		font-size: 12px;
		color: var(--text-secondary);
		margin-bottom: 8px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.mode-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.mode-card {
		padding: 16px 8px;
		background: var(--bg-tertiary);
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: center;
		transition: var(--transition-fast);
		color: var(--text-primary);
	}
	.mode-card:hover { background: var(--bg-hover); }
	.mode-card.active {
		border-color: var(--text-primary);
		background: var(--bg-active);
	}
	.mode-icon { display: block; font-size: 24px; margin-bottom: 6px; }
	.mode-label { font-size: 11px; color: var(--text-secondary); }
	.select {
		width: 100%;
		padding: 8px 12px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 13px;
	}
	.select:focus { border-color: var(--border-focus); outline: none; }
	.quality-group { display: flex; gap: 8px; }
	.quality-btn {
		flex: 1;
		padding: 8px;
		background: var(--bg-tertiary);
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: var(--transition-fast);
	}
	.quality-btn:hover { background: var(--bg-hover); }
	.quality-btn.active {
		border-color: var(--text-primary);
		color: var(--text-primary);
	}
	.start-btn {
		width: 100%;
		padding: 14px;
		margin-top: 24px;
		background: #ff3333;
		border: none;
		border-radius: var(--radius-lg);
		color: white;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		transition: var(--transition-fast);
	}
	.start-btn:hover { background: #ff5555; }
	.record-dot {
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
	}
</style>
