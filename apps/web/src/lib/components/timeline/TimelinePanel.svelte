<script lang="ts">
	import { getTimeline } from '$lib/state/context.js';
	import TimelineToolbar from './TimelineToolbar.svelte';
	import TrackHeader from './TrackHeader.svelte';
	import TimelineCanvas from './TimelineCanvas.svelte';

	const timeline = getTimeline();
</script>

<div class="timeline-panel">
	<TimelineToolbar />
	<div class="timeline-body">
		<div class="track-headers">
			<div class="ruler-spacer"></div>
			{#each timeline.tracks as track, i (track.id)}
				<TrackHeader {track} index={i} />
			{/each}
			{#if timeline.tracks.length === 0}
				<div class="empty-tracks">
					<span>Drag media here to create tracks</span>
				</div>
			{/if}
		</div>
		<div class="canvas-area">
			<TimelineCanvas />
		</div>
	</div>
</div>

<style>
	.timeline-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.timeline-body {
		flex: 1;
		display: flex;
		min-height: 0;
		overflow: hidden;
	}

	.track-headers {
		width: 120px;
		min-width: 120px;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border-primary);
		overflow-y: auto;
	}

	.ruler-spacer {
		height: 30px;
		border-bottom: 1px solid var(--border-primary);
	}

	.canvas-area {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.empty-tracks {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		color: var(--text-muted);
		font-size: 11px;
		text-align: center;
	}
</style>
