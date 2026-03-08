<script lang="ts">
	import type { ExportProgress } from '$lib/types/index.js';
	import { formatFileSize } from '$lib/utils/file.js';

	interface Props {
		progress: ExportProgress;
	}

	let { progress }: Props = $props();

	let percentage = $derived(Math.round(progress.progress * 100));
</script>

<div class="export-progress">
	<div class="stage">{progress.stage.toUpperCase()}</div>

	<div class="progress-bar">
		<div class="progress-fill" style="width: {percentage}%"></div>
	</div>

	<div class="progress-info">
		<span>{percentage}%</span>
		{#if progress.elapsed > 0}
			<span>Elapsed: {Math.round(progress.elapsed / 1000)}s</span>
		{/if}
		{#if progress.outputSize > 0}
			<span>Size: {formatFileSize(progress.outputSize)}</span>
		{/if}
	</div>

	{#if progress.stage === 'done'}
		<div class="done-message">Export complete!</div>
	{/if}

	{#if progress.stage === 'error'}
		<div class="error-message">Export failed. Please try again.</div>
	{/if}
</div>

<style>
	.export-progress {
		padding: 12px 0;
	}

	.stage {
		font-size: 10px;
		font-weight: 600;
		color: var(--text-tertiary);
		letter-spacing: 1px;
		margin-bottom: 8px;
	}

	.progress-bar {
		height: 6px;
		background: var(--bg-surface);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 8px;
	}

	.progress-fill {
		height: 100%;
		background: var(--text-primary);
		transition: width 0.3s ease;
		border-radius: 3px;
	}

	.progress-info {
		display: flex;
		gap: 16px;
		font-size: 10px;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.done-message {
		margin-top: 12px;
		color: var(--success);
		font-size: 12px;
		font-weight: 500;
	}

	.error-message {
		margin-top: 12px;
		color: var(--danger);
		font-size: 12px;
	}
</style>
