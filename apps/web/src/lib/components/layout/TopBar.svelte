<script lang="ts">
	import { getProject, getUI, getCommands, getTimeline, getPlayback } from '$lib/state/context.js';
	import { ASPECT_RATIOS } from '$lib/utils/aspect-ratios.js';
	import Button from '../shared/Button.svelte';
	import Icon from '../shared/Icon.svelte';

	const project = getProject();
	const ui = getUI();
	const commands = getCommands();
	const timeline = getTimeline();
	const playback = getPlayback();

	interface Props {
		onimport?: () => void;
		onnewproject?: () => void;
		onshortcuts?: () => void;
	}

	let { onimport, onnewproject, onshortcuts }: Props = $props();
	let showRatioMenu = $state(false);

	function handleExport() {
		ui.showExportDialog = true;
	}

	function handleCaptions() {
		ui.showCaptionDialog = true;
	}

	function handleVoiceover() {
		ui.showVoiceoverDialog = true;
	}

	function handleUndo() {
		commands.undo();
	}

	function handleRedo() {
		commands.redo();
	}

	function toggleRatioMenu() {
		showRatioMenu = !showRatioMenu;
	}

	function selectRatio(ratio: (typeof ASPECT_RATIOS)[number]) {
		project.setAspectRatio({ width: ratio.width, height: ratio.height, label: ratio.label });
		showRatioMenu = false;
	}

	function handleRatioKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showRatioMenu = false;
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onclick={() => { if (showRatioMenu) showRatioMenu = false; }} />

<header class="topbar">
	<div class="topbar-left">
		<span class="logo">MEOW</span>
		<div class="separator"></div>
		<Button variant="ghost" size="sm" onclick={onnewproject}>New</Button>
		<Button variant="ghost" size="sm" onclick={onimport}>
			<Icon name="import" size={14} />
			Import
		</Button>
	</div>

	<div class="topbar-center">
		<span class="project-name">{project.name}</span>
		<div class="separator"></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ratio-picker" onkeydown={handleRatioKeydown}>
			<button class="ratio-pill" onclick={(e) => { e.stopPropagation(); toggleRatioMenu(); }} title="Aspect Ratio">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="2" y="3" width="20" height="18" rx="2" />
				</svg>
				{project.aspectRatio.label}
				<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>
			{#if showRatioMenu}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="ratio-menu" onclick={(e) => e.stopPropagation()}>
					{#each ASPECT_RATIOS as ratio}
						<button
							class="ratio-option"
							class:active={project.aspectRatio.label === ratio.label}
							onclick={() => selectRatio(ratio)}
						>
							<span class="ratio-label">{ratio.label}</span>
							<span class="ratio-desc">{ratio.description}</span>
							<span class="ratio-dims">{ratio.width}x{ratio.height}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="topbar-right">
		<Button variant="ghost" size="sm" onclick={handleUndo} disabled={!commands.canUndo} title="Undo (Ctrl+Z)">
			<Icon name="undo" size={14} />
		</Button>
		<Button variant="ghost" size="sm" onclick={handleRedo} disabled={!commands.canRedo} title="Redo (Ctrl+Shift+Z)">
			<Icon name="redo" size={14} />
		</Button>
		<div class="separator"></div>
		<Button variant="ghost" size="sm" onclick={handleCaptions} disabled={timeline.tracks.length === 0} title="Auto Captions">
			<Icon name="captions" size={14} />
			CC
		</Button>
		<Button variant="ghost" size="sm" onclick={handleVoiceover} title="AI Voiceover">
			<Icon name="voiceover" size={14} />
			Voiceover
		</Button>
		<Button variant="ghost" size="sm" onclick={onshortcuts} title="Keyboard shortcuts (?)">
			<Icon name="keyboard" size={14} />
		</Button>
		<div class="separator"></div>
		<Button variant="primary" size="sm" onclick={handleExport} disabled={timeline.tracks.length === 0}>
			<Icon name="export" size={14} />
			Export
		</Button>
	</div>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 40px;
		padding: 0 12px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-primary);
	}

	.topbar-left, .topbar-right {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.topbar-center {
		display: flex;
		align-items: center;
	}

	.logo {
		font-weight: 700;
		font-size: 14px;
		letter-spacing: 2px;
		color: var(--text-primary);
	}

	.project-name {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.separator {
		width: 1px;
		height: 20px;
		background: var(--border-primary);
		margin: 0 4px;
	}

	.ratio-picker {
		position: relative;
	}

	.ratio-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border: 1px solid var(--border-primary);
		border-radius: 10px;
		background: var(--bg-tertiary, var(--bg-secondary));
		color: var(--text-secondary);
		font-size: 11px;
		font-family: inherit;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
		white-space: nowrap;
	}

	.ratio-pill:hover {
		border-color: var(--text-muted);
		color: var(--text-primary);
	}

	.ratio-menu {
		position: absolute;
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		min-width: 240px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 100;
		padding: 4px;
		display: flex;
		flex-direction: column;
	}

	.ratio-option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.ratio-option:hover {
		background: var(--bg-hover, rgba(255, 255, 255, 0.06));
	}

	.ratio-option.active {
		background: var(--bg-active, rgba(255, 255, 255, 0.1));
		color: var(--text-primary);
	}

	.ratio-label {
		font-weight: 600;
		min-width: 36px;
		color: var(--text-primary);
	}

	.ratio-desc {
		flex: 1;
		color: var(--text-muted);
		font-size: 11px;
	}

	.ratio-dims {
		color: var(--text-muted);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
</style>
