<script lang="ts">
	import { getPlayback, getTimeline } from '$lib/state/context.js';
	import Button from '../shared/Button.svelte';
	import Icon from '../shared/Icon.svelte';

	const { onplayclick }: { onplayclick?: () => void } = $props();

	const playback = getPlayback();
	const timeline = getTimeline();

	function handlePlayPause() {
		// Call the play handler FIRST (in click context) — then toggle state
		onplayclick?.();
		playback.toggle();
	}

	function skipBack() {
		playback.seekRelative(-5);
	}

	function skipForward() {
		playback.seekRelative(5);
	}

	function goToStart() {
		playback.goToStart();
	}

	function goToEnd() {
		playback.seek(timeline.totalDuration);
	}

	function toggleLoop() {
		playback.loopEnabled = !playback.loopEnabled;
	}
</script>

<div class="transport">
	<Button variant="ghost" size="sm" onclick={goToStart} title="Go to start (Home)">
		<Icon name="skip-back" size={16} />
	</Button>
	<Button variant="ghost" size="sm" onclick={skipBack} title="Skip back 5s">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
	</Button>
	<Button variant="ghost" size="md" onclick={handlePlayPause} title="Play/Pause (Space)">
		<Icon name={playback.playing ? 'pause' : 'play'} size={20} />
	</Button>
	<Button variant="ghost" size="sm" onclick={skipForward} title="Skip forward 5s">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
	</Button>
	<Button variant="ghost" size="sm" onclick={goToEnd} title="Go to end (End)">
		<Icon name="skip-forward" size={16} />
	</Button>
	<div class="separator"></div>
	<Button variant="ghost" size="sm" onclick={toggleLoop} active={playback.loopEnabled} title="Loop">
		<Icon name="loop" size={14} />
	</Button>
	<span class="timecode">{playback.formattedTime}</span>
</div>

<style>
	.transport {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		padding: 6px 0;
	}

	.separator {
		width: 1px;
		height: 20px;
		background: var(--border-primary);
		margin: 0 6px;
	}

	.timecode {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-tertiary);
		margin-left: 8px;
		min-width: 80px;
	}
</style>
