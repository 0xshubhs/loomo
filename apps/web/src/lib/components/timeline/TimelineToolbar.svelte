<script lang="ts">
	import { getUI, getTimeline, getSelection, getPlayback, getCommands } from '$lib/state/context.js';
	import { SplitClipCommand, RemoveClipCommand } from '$lib/commands/clip-commands.js';
	import { AddTrackCommand } from '$lib/commands/track-commands.js';
	import Button from '../shared/Button.svelte';
	import Icon from '../shared/Icon.svelte';

	const ui = getUI();
	const timeline = getTimeline();
	const selection = getSelection();
	const playback = getPlayback();
	const commands = getCommands();

	function handleSplit() {
		for (const clipId of selection.selectedClipIds) {
			const clip = timeline.getClipById(clipId);
			if (!clip) continue;
			if (playback.currentTime > clip.timelineStart && playback.currentTime < clip.timelineStart + clip.duration) {
				commands.execute(new SplitClipCommand(timeline, clipId, playback.currentTime));
			}
		}
	}

	function handleDelete() {
		for (const clipId of selection.selectedClipIds) {
			commands.execute(new RemoveClipCommand(timeline, clipId));
		}
		selection.deselectAll();
	}

	function handleAddVideoTrack() {
		commands.execute(new AddTrackCommand(timeline, 'video'));
	}

	function handleAddAudioTrack() {
		commands.execute(new AddTrackCommand(timeline, 'audio'));
	}

	function toggleSnap() {
		ui.snapEnabled = !ui.snapEnabled;
	}
</script>

<div class="timeline-toolbar">
	<div class="toolbar-left">
		<Button variant="ghost" size="sm" active={ui.activeTool === 'select'} onclick={() => ui.activeTool = 'select'} title="Select (V)">
			<Icon name="cursor" size={14} />
		</Button>
		<Button variant="ghost" size="sm" active={ui.activeTool === 'razor'} onclick={() => ui.activeTool = 'razor'} title="Razor (C)">
			<Icon name="razor" size={14} />
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={handleSplit} disabled={!selection.hasSelection} title="Split at playhead (S)">
			<Icon name="split" size={14} />
		</Button>
		<Button variant="ghost" size="sm" onclick={handleDelete} disabled={!selection.hasSelection} title="Delete (Del)">
			<Icon name="delete" size={14} />
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={toggleSnap} active={ui.snapEnabled} title="Snap">
			<Icon name="snap" size={14} />
		</Button>
	</div>

	<div class="toolbar-right">
		<Button variant="ghost" size="sm" onclick={handleAddVideoTrack} title="Add video track">
			+ V
		</Button>
		<Button variant="ghost" size="sm" onclick={handleAddAudioTrack} title="Add audio track">
			+ A
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={() => ui.zoomOut()} title="Zoom out">
			<Icon name="zoom-out" size={14} />
		</Button>
		<span class="zoom-label">{Math.round(ui.timelineZoom)}%</span>
		<Button variant="ghost" size="sm" onclick={() => ui.zoomIn()} title="Zoom in">
			<Icon name="zoom-in" size={14} />
		</Button>
	</div>
</div>

<style>
	.timeline-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-primary);
		height: 32px;
	}

	.toolbar-left, .toolbar-right {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.sep {
		width: 1px;
		height: 16px;
		background: var(--border-primary);
		margin: 0 4px;
	}

	.zoom-label {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		min-width: 35px;
		text-align: center;
	}
</style>
