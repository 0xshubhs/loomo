<script lang="ts">
	import { getPlayback, getTimeline, getUI, getCommands } from '$lib/state/context.js';
	import { formatDuration } from '$lib/utils/time.js';

	const playback = getPlayback();
	const timeline = getTimeline();
	const ui = getUI();
	const commands = getCommands();
</script>

<footer class="statusbar">
	<div class="statusbar-left">
		<span class="status-item">
			{playback.formattedTime} / {formatDuration(timeline.totalDuration)}
		</span>
		<span class="status-item">
			{timeline.tracks.length} tracks
		</span>
		<span class="status-item">
			{timeline.flatClips.length} clips
		</span>
	</div>

	<div class="statusbar-right">
		{#if commands.lastAction}
			<span class="status-item last-action">{commands.lastAction}</span>
		{/if}
		<span class="status-item">Zoom: {Math.round(ui.timelineZoom)}%</span>
		<span class="status-item">{ui.snapEnabled ? 'Snap ON' : 'Snap OFF'}</span>
	</div>
</footer>

<style>
	.statusbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 24px;
		padding: 0 12px;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border-primary);
		font-size: 10px;
		color: var(--text-tertiary);
	}

	.statusbar-left, .statusbar-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.status-item {
		font-family: var(--font-mono);
	}

	.last-action {
		color: var(--text-muted);
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
