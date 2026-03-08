<script lang="ts">
	import type { Track } from '$lib/types/index.js';
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import { MuteTrackCommand } from '$lib/commands/audio-commands.js';
	import Button from '../shared/Button.svelte';
	import Icon from '../shared/Icon.svelte';

	interface Props {
		track: Track;
		index: number;
	}

	let { track, index }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();

	function toggleMute() {
		commands.execute(new MuteTrackCommand(timeline, track.id, !track.muted));
	}

	function toggleLock() {
		track.locked = !track.locked;
		timeline.tracks = [...timeline.tracks];
	}

	function toggleVisible() {
		track.visible = !track.visible;
		timeline.tracks = [...timeline.tracks];
	}
</script>

<div class="track-header" style="height: 80px">
	<span class="track-name">{track.name}</span>
	<div class="track-controls">
		<button class="icon-btn" class:active={track.muted} onclick={toggleMute} title={track.muted ? 'Unmute' : 'Mute'}>
			<Icon name={track.muted ? 'mute' : 'volume'} size={12} />
		</button>
		{#if track.type === 'video'}
			<button class="icon-btn" class:active={!track.visible} onclick={toggleVisible} title={track.visible ? 'Hide' : 'Show'}>
				<Icon name={track.visible ? 'eye' : 'eye-off'} size={12} />
			</button>
		{/if}
		<button class="icon-btn" class:active={track.locked} onclick={toggleLock} title={track.locked ? 'Unlock' : 'Lock'}>
			<Icon name={track.locked ? 'lock' : 'unlock'} size={12} />
		</button>
	</div>
</div>

<style>
	.track-header {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border-primary);
		background: var(--bg-secondary);
	}

	.track-name {
		font-size: 10px;
		color: var(--text-secondary);
		margin-bottom: 4px;
		font-weight: 500;
	}

	.track-controls {
		display: flex;
		gap: 2px;
	}

	.icon-btn {
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		color: var(--text-muted);
		transition: all var(--transition-fast);
	}

	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.icon-btn.active {
		color: var(--warning);
	}
</style>
