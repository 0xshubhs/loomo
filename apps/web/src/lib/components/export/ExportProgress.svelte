<script lang="ts">
	import type { ExportProgress } from '$lib/types/index.js';
	import { formatFileSize } from '$lib/utils/file.js';

	interface Props {
		progress: ExportProgress;
	}

	let { progress }: Props = $props();

	let percentage = $derived(Math.round(progress.progress * 100));

	// Plain words rather than the internal stage identifier.
	const STAGE_LABELS: Record<ExportProgress['stage'], string> = {
		preparing: 'Preparing your clips',
		rendering: 'Rendering',
		encoding: 'Encoding video',
		finalizing: 'Finishing up',
		done: 'Export complete',
		error: 'Export failed',
	};

	/**
	 * Remaining time projected from the rate so far.
	 *
	 * Hidden below 5% because the early estimate swings wildly and a number
	 * that jumps from "8 minutes" to "40 seconds" is worse than none.
	 */
	let remaining = $derived.by(() => {
		if (progress.progress <= 0.05 || progress.elapsed <= 0) return null;
		if (progress.stage === 'done' || progress.stage === 'error') return null;
		const total = progress.elapsed / progress.progress;
		return Math.max(0, Math.round((total - progress.elapsed) / 1000));
	});

	function formatDuration(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
	}

	let indeterminate = $derived(progress.progress <= 0 && progress.stage !== 'done');
</script>

<div class="export-progress">
	<div class="stage">{STAGE_LABELS[progress.stage] ?? 'Working'}</div>

	<div class="progress-bar" class:indeterminate>
		<div class="progress-fill" style="width: {indeterminate ? 100 : percentage}%"></div>
	</div>

	<div class="progress-info">
		<span class="percent">{indeterminate ? '' : `${percentage}%`}</span>
		{#if remaining !== null}
			<span>About {formatDuration(remaining)} left</span>
		{:else if progress.elapsed > 0 && progress.stage !== 'done'}
			<span>Starting…</span>
		{/if}
		{#if progress.elapsed > 0}
			<span>{formatDuration(Math.round(progress.elapsed / 1000))} elapsed</span>
		{/if}
		{#if progress.outputSize > 0}
			<span>{formatFileSize(progress.outputSize)}</span>
		{/if}
	</div>

	<p class="hint">Large exports take a while — 4K especially. You can leave this open.</p>

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

	/* Before ffmpeg reports its first timestamp there is nothing honest to
	   show, so the bar sweeps instead of sitting at a fake zero. */
	.progress-bar.indeterminate .progress-fill {
		animation: sweep 1.4s ease-in-out infinite;
		transform-origin: left center;
	}

	@keyframes sweep {
		0% { transform: scaleX(0.15); opacity: 0.5; }
		50% { transform: scaleX(1); opacity: 1; }
		100% { transform: scaleX(0.15); opacity: 0.5; }
	}

	.percent {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--text-primary);
	}

	.hint {
		font-size: 10px;
		color: var(--text-tertiary);
		margin: 10px 0 0;
		line-height: 1.4;
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
