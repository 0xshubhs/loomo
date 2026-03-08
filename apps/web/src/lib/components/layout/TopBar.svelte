<script lang="ts">
	import { getProject, getUI, getCommands, getTimeline, getPlayback } from '$lib/state/context.js';
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
	}

	let { onimport, onnewproject }: Props = $props();

	function handleExport() {
		ui.showExportDialog = true;
	}

	function handleUndo() {
		commands.undo();
	}

	function handleRedo() {
		commands.redo();
	}
</script>

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
	</div>

	<div class="topbar-right">
		<Button variant="ghost" size="sm" onclick={handleUndo} disabled={!commands.canUndo} title="Undo (Ctrl+Z)">
			<Icon name="undo" size={14} />
		</Button>
		<Button variant="ghost" size="sm" onclick={handleRedo} disabled={!commands.canRedo} title="Redo (Ctrl+Y)">
			<Icon name="redo" size={14} />
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
</style>
