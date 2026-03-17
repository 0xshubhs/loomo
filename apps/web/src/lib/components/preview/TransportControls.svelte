<script lang="ts">
	import { getPlayback, getTimeline } from '$lib/state/context.js';
	import Button from '../shared/Button.svelte';
	import Icon from '../shared/Icon.svelte';

	const { onplayclick, onfullscreen }: { onplayclick?: () => void; onfullscreen?: () => void } = $props();

	const playback = getPlayback();
	const timeline = getTimeline();

	const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2];
	let speedMenuOpen = $state(false);

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

	function stepBack() {
		playback.stepBackward(30);
	}

	function stepForward() {
		playback.stepForward(30);
	}

	function cycleSpeed() {
		const idx = SPEED_OPTIONS.indexOf(playback.playbackRate);
		const next = (idx + 1) % SPEED_OPTIONS.length;
		playback.setRate(SPEED_OPTIONS[next]);
	}

	function setSpeed(rate: number) {
		playback.setRate(rate);
		speedMenuOpen = false;
	}
</script>

<div class="transport">
	<Button variant="ghost" size="sm" onclick={goToStart} title="Go to start (Home)">
		<Icon name="skip-back" size={16} />
	</Button>
	<Button variant="ghost" size="sm" onclick={skipBack} title="Skip back 5s (J)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
	</Button>
	<Button variant="ghost" size="sm" onclick={stepBack} title="Step back 1 frame (Left)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="5" width="3" height="14" rx="1"/><path d="M20 5v14l-11-7z"/></svg>
	</Button>
	<Button variant="ghost" size="md" onclick={handlePlayPause} title="Play/Pause (Space)">
		<Icon name={playback.playing ? 'pause' : 'play'} size={20} />
	</Button>
	<Button variant="ghost" size="sm" onclick={stepForward} title="Step forward 1 frame (Right)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 5v14l11-7z"/><rect x="17" y="5" width="3" height="14" rx="1"/></svg>
	</Button>
	<Button variant="ghost" size="sm" onclick={skipForward} title="Skip forward 5s (L)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
	</Button>
	<Button variant="ghost" size="sm" onclick={goToEnd} title="Go to end (End)">
		<Icon name="skip-forward" size={16} />
	</Button>
	<div class="separator"></div>
	<Button variant="ghost" size="sm" onclick={toggleLoop} active={playback.loopEnabled} title="Loop">
		<Icon name="loop" size={14} />
	</Button>
	<div class="separator"></div>
	<div class="speed-control">
		<button
			class="speed-btn"
			onclick={cycleSpeed}
			oncontextmenu={(e) => { e.preventDefault(); speedMenuOpen = !speedMenuOpen; }}
			title="Click to cycle speed, right-click for menu"
		>
			{playback.playbackRate === 1 ? '1x' : `${playback.playbackRate}x`}
		</button>
		{#if speedMenuOpen}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="speed-backdrop" onclick={() => speedMenuOpen = false} onkeydown={() => {}}></div>
			<div class="speed-menu">
				{#each SPEED_OPTIONS as rate}
					<button
						class="speed-option"
						class:active={playback.playbackRate === rate}
						onclick={() => setSpeed(rate)}
					>
						{rate}x
					</button>
				{/each}
			</div>
		{/if}
	</div>
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

	.speed-control {
		position: relative;
	}

	.speed-btn {
		padding: 2px 8px;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 600;
		font-family: var(--font-mono);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.speed-btn:hover {
		color: var(--text-primary);
		border-color: var(--text-tertiary);
	}

	.speed-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
	}

	.speed-menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: var(--bg-secondary, #1c1c1c);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 4px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		min-width: 64px;
	}

	.speed-option {
		padding: 5px 12px;
		border: none;
		background: transparent;
		border-radius: 4px;
		color: var(--text-secondary);
		font-size: 12px;
		font-family: var(--font-mono);
		cursor: pointer;
		text-align: center;
		transition: all 0.12s ease;
	}

	.speed-option:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.speed-option.active {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.1);
		font-weight: 600;
	}
</style>
