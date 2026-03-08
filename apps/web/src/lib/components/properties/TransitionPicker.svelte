<script lang="ts">
	import type { Transition, TransitionType } from '$lib/types/index.js';
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import { UpdateTransitionCommand, RemoveTransitionCommand } from '$lib/commands/transition-commands.js';
	import Slider from '../shared/Slider.svelte';
	import Button from '../shared/Button.svelte';

	interface Props {
		transition: Transition;
	}

	let { transition }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();

	const transitionTypes: { value: TransitionType; label: string }[] = [
		{ value: 'fade', label: 'Fade' },
		{ value: 'dissolve', label: 'Dissolve' },
		{ value: 'wipe-left', label: 'Wipe Left' },
		{ value: 'wipe-right', label: 'Wipe Right' },
		{ value: 'wipe-up', label: 'Wipe Up' },
		{ value: 'wipe-down', label: 'Wipe Down' },
		{ value: 'slide-left', label: 'Slide Left' },
		{ value: 'slide-right', label: 'Slide Right' },
		{ value: 'zoom-in', label: 'Zoom In' },
		{ value: 'zoom-out', label: 'Zoom Out' },
		{ value: 'blur', label: 'Blur' },
	];

	function setType(type: TransitionType) {
		commands.execute(new UpdateTransitionCommand(timeline, transition.id, type));
	}

	function setDuration(value: number) {
		commands.execute(new UpdateTransitionCommand(timeline, transition.id, undefined, value));
	}

	function removeTransition() {
		commands.execute(new RemoveTransitionCommand(timeline, transition.id));
	}
</script>

<div class="transition-picker">
	<h4>Transition</h4>

	<div class="type-grid">
		{#each transitionTypes as t}
			<button
				class="type-btn"
				class:active={transition.type === t.value}
				onclick={() => setType(t.value)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<div class="duration-control">
		<Slider
			label="Duration"
			value={transition.duration}
			min={0.1}
			max={3}
			step={0.1}
			oninput={setDuration}
		/>
	</div>

	<Button variant="danger" size="sm" onclick={removeTransition}>Remove Transition</Button>
</div>

<style>
	.transition-picker h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 8px;
	}

	.type-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin-bottom: 12px;
	}

	.type-btn {
		padding: 4px 8px;
		font-size: 10px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.type-btn:hover {
		background: var(--bg-hover);
	}

	.type-btn.active {
		background: var(--bg-active);
		border-color: var(--text-tertiary);
		color: var(--text-primary);
	}

	.duration-control {
		margin-bottom: 12px;
	}
</style>
