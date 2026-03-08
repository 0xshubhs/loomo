<script lang="ts">
	import type { Clip } from '$lib/types/index.js';
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import { SetVolumeCommand } from '$lib/commands/audio-commands.js';
	import { formatDuration } from '$lib/utils/time.js';
	import Slider from '../shared/Slider.svelte';

	interface Props {
		clip: Clip;
	}

	let { clip }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();

	function handleVolumeChange(value: number) {
		commands.execute(new SetVolumeCommand(timeline, clip.id, value / 100));
	}
</script>

<div class="clip-properties">
	<h4>Clip</h4>
	<div class="prop-row">
		<span class="prop-label">Name</span>
		<span class="prop-value">{clip.name}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Type</span>
		<span class="prop-value">{clip.type}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Start</span>
		<span class="prop-value">{formatDuration(clip.timelineStart)}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Duration</span>
		<span class="prop-value">{formatDuration(clip.duration)}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Source</span>
		<span class="prop-value">{formatDuration(clip.sourceStart)} - {formatDuration(clip.sourceEnd)}</span>
	</div>

	<div class="prop-section">
		<Slider
			label="Volume"
			value={Math.round(clip.volume * 100)}
			min={0}
			max={200}
			step={1}
			oninput={handleVolumeChange}
		/>
	</div>

	<div class="prop-section">
		<Slider
			label="Speed"
			value={clip.speed}
			min={0.25}
			max={4}
			step={0.25}
		/>
	</div>

	<div class="prop-section">
		<Slider
			label="Opacity"
			value={Math.round(clip.opacity * 100)}
			min={0}
			max={100}
			step={1}
		/>
	</div>
</div>

<style>
	.clip-properties h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 8px;
	}

	.prop-row {
		display: flex;
		justify-content: space-between;
		padding: 3px 0;
	}

	.prop-label {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.prop-value {
		font-size: 11px;
		color: var(--text-secondary);
		font-family: var(--font-mono);
	}

	.prop-section {
		margin-top: 8px;
	}
</style>
