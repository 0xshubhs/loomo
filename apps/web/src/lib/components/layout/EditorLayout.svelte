<script lang="ts">
	import { getUI } from '$lib/state/context.js';

	interface Props {
		topbar?: import('svelte').Snippet;
		mediaBrowser?: import('svelte').Snippet;
		preview?: import('svelte').Snippet;
		timeline?: import('svelte').Snippet;
		statusbar?: import('svelte').Snippet;
		properties?: import('svelte').Snippet;
		exportDialog?: import('svelte').Snippet;
	}

	let { topbar, mediaBrowser, preview, timeline, statusbar, properties, exportDialog }: Props = $props();

	const ui = getUI();

	let draggingPanel: 'left' | 'bottom' | null = $state(null);

	function onPanelDragStart(panel: 'left' | 'bottom') {
		return (e: MouseEvent) => {
			e.preventDefault();
			draggingPanel = panel;
			window.addEventListener('mousemove', onPanelDragMove);
			window.addEventListener('mouseup', onPanelDragEnd);
		};
	}

	function onPanelDragMove(e: MouseEvent) {
		if (draggingPanel === 'left') {
			ui.panelSizes = { ...ui.panelSizes, left: Math.max(180, Math.min(500, e.clientX)) };
		} else if (draggingPanel === 'bottom') {
			ui.panelSizes = { ...ui.panelSizes, bottom: Math.max(150, Math.min(600, window.innerHeight - e.clientY)) };
		}
	}

	function onPanelDragEnd() {
		draggingPanel = null;
		window.removeEventListener('mousemove', onPanelDragMove);
		window.removeEventListener('mouseup', onPanelDragEnd);
	}
</script>

<div class="editor-layout" style="--left-width:{ui.panelSizes.left}px;--bottom-height:{ui.panelSizes.bottom}px">
	<div class="topbar-area">
		{#if topbar}{@render topbar()}{/if}
	</div>

	<div class="main-area">
		<div class="left-panel">
			{#if mediaBrowser}{@render mediaBrowser()}{/if}
		</div>

		<div class="resize-handle-h" onmousedown={onPanelDragStart('left')} role="separator"></div>

		<div class="center-panel">
			{#if preview}{@render preview()}{/if}
		</div>

		{#if ui.activePanel === 'properties' && properties}
			<div class="right-panel">
				{@render properties()}
			</div>
		{/if}
	</div>

	<div class="resize-handle-v" onmousedown={onPanelDragStart('bottom')} role="separator"></div>

	<div class="timeline-area">
		{#if timeline}{@render timeline()}{/if}
	</div>

	<div class="statusbar-area">
		{#if statusbar}{@render statusbar()}{/if}
	</div>

	{#if exportDialog}
		{@render exportDialog()}
	{/if}
</div>

<style>
	.editor-layout {
		display: grid;
		grid-template-rows: auto 1fr auto auto auto;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
	}

	.topbar-area {
		grid-row: 1;
	}

	.main-area {
		grid-row: 2;
		display: flex;
		min-height: 0;
		overflow: hidden;
	}

	.left-panel {
		width: var(--left-width);
		min-width: 180px;
		background: var(--bg-secondary);
		border-right: 1px solid var(--border-primary);
		overflow-y: auto;
	}

	.resize-handle-h {
		width: 4px;
		cursor: col-resize;
		background: transparent;
		transition: background var(--transition-fast);
	}

	.resize-handle-h:hover,
	.resize-handle-h:active {
		background: var(--border-secondary);
	}

	.center-panel {
		flex: 1;
		min-width: 0;
		background: var(--bg-primary);
		display: flex;
		flex-direction: column;
	}

	.right-panel {
		width: 280px;
		background: var(--bg-secondary);
		border-left: 1px solid var(--border-primary);
		overflow-y: auto;
	}

	.resize-handle-v {
		height: 4px;
		cursor: row-resize;
		background: transparent;
		transition: background var(--transition-fast);
	}

	.resize-handle-v:hover,
	.resize-handle-v:active {
		background: var(--border-secondary);
	}

	.timeline-area {
		height: var(--bottom-height);
		min-height: 150px;
		background: var(--bg-primary);
		border-top: 1px solid var(--border-primary);
		overflow: hidden;
	}

	.statusbar-area {
		grid-row: 5;
	}
</style>
