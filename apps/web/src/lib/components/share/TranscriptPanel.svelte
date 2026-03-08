<script lang="ts">
	interface Segment {
		start: number;
		end: number;
		text: string;
	}

	interface Props {
		segments: Segment[];
		currentTime: number;
		onseek?: (time: number) => void;
	}

	let { segments, currentTime, onseek }: Props = $props();

	let activeIndex = $derived(
		segments.findIndex(seg => currentTime >= seg.start && currentTime < seg.end)
	);

	function formatTimestamp(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleClick(time: number) {
		onseek?.(time);
	}
</script>

<div class="transcript-panel">
	{#if segments.length === 0}
		<div class="empty">
			<p class="empty-text">No transcript available</p>
		</div>
	{:else}
		<div class="segments">
			{#each segments as segment, i (i)}
				<button
					class="segment"
					class:active={i === activeIndex}
					onclick={() => handleClick(segment.start)}
				>
					<span class="timestamp">{formatTimestamp(segment.start)}</span>
					<span class="text">{segment.text}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.transcript-panel {
		height: 100%;
		overflow-y: auto;
	}
	.empty {
		padding: 40px 20px;
		text-align: center;
	}
	.empty-text {
		color: var(--text-muted);
		font-size: 13px;
	}
	.segments {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 0;
	}
	.segment {
		display: flex;
		gap: 12px;
		padding: 8px 16px;
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
		color: var(--text-secondary);
		width: 100%;
	}
	.segment:hover {
		background: var(--bg-hover);
	}
	.segment.active {
		background: var(--bg-active);
		color: var(--text-primary);
	}
	.timestamp {
		flex-shrink: 0;
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--text-muted);
		min-width: 36px;
		padding-top: 1px;
	}
	.segment.active .timestamp {
		color: var(--text-secondary);
	}
	.text {
		font-size: 13px;
		line-height: 1.5;
	}
</style>
