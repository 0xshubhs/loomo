<script lang="ts">
	import { getSelection, getTimeline, getUI, getCommands } from '$lib/state/context.js';
	import ClipProperties from './ClipProperties.svelte';
	import TransitionPicker from './TransitionPicker.svelte';
	import TextEditor from './TextEditor.svelte';
	import AudioMixer from './AudioMixer.svelte';

	const selection = getSelection();
	const timeline = getTimeline();

	let selectedClip = $derived.by(() => {
		const ids = Array.from(selection.selectedClipIds);
		if (ids.length !== 1) return null;
		return timeline.getClipById(ids[0]) ?? null;
	});

	let selectedTransition = $derived.by(() => {
		if (!selection.selectedTransitionId) return null;
		return timeline.transitions.find(t => t.id === selection.selectedTransitionId) ?? null;
	});

	let selectedText = $derived.by(() => {
		if (!selection.selectedTextId) return null;
		return timeline.textOverlays.find(t => t.id === selection.selectedTextId) ?? null;
	});
</script>

<div class="properties-panel">
	<div class="panel-header">
		<h3>Properties</h3>
	</div>

	<div class="panel-body">
		{#if selectedClip}
			<ClipProperties clip={selectedClip} />
		{:else if selectedTransition}
			<TransitionPicker transition={selectedTransition} />
		{:else if selectedText}
			<TextEditor overlay={selectedText} />
		{:else}
			<div class="no-selection">
				<p>Select a clip, transition, or text overlay to edit its properties</p>
			</div>
		{/if}

		<div class="section-divider"></div>
		<AudioMixer />
	</div>
</div>

<style>
	.properties-panel {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.panel-header {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border-primary);
	}

	.panel-header h3 {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
	}

	.no-selection {
		color: var(--text-muted);
		font-size: 11px;
		text-align: center;
		padding: 20px;
	}

	.section-divider {
		height: 1px;
		background: var(--border-primary);
		margin: 12px 0;
	}
</style>
