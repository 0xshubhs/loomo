<script lang="ts">
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import { SetTrackVolumeCommand, MuteTrackCommand } from '$lib/commands/audio-commands.js';
	import Slider from '../shared/Slider.svelte';
	import Icon from '../shared/Icon.svelte';

	const timeline = getTimeline();
	const commands = getCommands();

	function handleVolumeChange(trackId: string, value: number) {
		commands.execute(new SetTrackVolumeCommand(timeline, trackId, value / 100));
	}

	function toggleMute(trackId: string, currentMuted: boolean) {
		commands.execute(new MuteTrackCommand(timeline, trackId, !currentMuted));
	}
</script>

<div class="audio-mixer">
	<h4>Audio Mixer</h4>

	{#each timeline.tracks as track (track.id)}
		<div class="mixer-track">
			<div class="track-info">
				<span class="track-name">{track.name}</span>
				<button
					class="mute-btn"
					class:muted={track.muted}
					onclick={() => toggleMute(track.id, track.muted)}
				>
					<Icon name={track.muted ? 'mute' : 'volume'} size={12} />
				</button>
			</div>
			<Slider
				value={Math.round(track.volume * 100)}
				min={0}
				max={200}
				step={1}
				oninput={(v) => handleVolumeChange(track.id, v)}
			/>
		</div>
	{/each}

	{#if timeline.tracks.length === 0}
		<p class="empty">No tracks</p>
	{/if}
</div>

<style>
	.audio-mixer h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 8px;
	}

	.mixer-track {
		margin-bottom: 8px;
	}

	.track-info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 3px;
	}

	.track-name {
		font-size: 10px;
		color: var(--text-tertiary);
	}

	.mute-btn {
		color: var(--text-muted);
		padding: 2px;
	}

	.mute-btn:hover {
		color: var(--text-secondary);
	}

	.mute-btn.muted {
		color: var(--warning);
	}

	.empty {
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
