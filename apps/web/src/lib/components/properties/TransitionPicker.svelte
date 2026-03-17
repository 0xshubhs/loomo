<script lang="ts">
	import type { Transition, TransitionType, TransitionCategory } from '$lib/types/index.js';
	import { TRANSITION_LIST, TRANSITION_CATEGORIES } from '$lib/types/effects.js';
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

	let activeCategory = $state<TransitionCategory | 'all'>('all');

	let filteredTransitions = $derived(
		activeCategory === 'all'
			? TRANSITION_LIST
			: TRANSITION_LIST.filter((t) => t.category === activeCategory)
	);

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

	<div class="category-tabs">
		<button class="cat-tab" class:active={activeCategory === 'all'} onclick={() => activeCategory = 'all'}>All</button>
		{#each TRANSITION_CATEGORIES as cat}
			<button class="cat-tab" class:active={activeCategory === cat.id} onclick={() => activeCategory = cat.id}>{cat.label}</button>
		{/each}
	</div>

	<div class="type-grid">
		{#each filteredTransitions as t}
			<button
				class="type-btn"
				class:active={transition.type === t.type}
				onclick={() => setType(t.type)}
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

	.category-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		margin-bottom: 8px;
	}

	.cat-tab {
		padding: 3px 8px;
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.3px;
		background: transparent;
		border: 1px solid var(--border-primary);
		border-radius: 3px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s ease;
	}

	.cat-tab:hover {
		color: var(--text-secondary);
	}

	.cat-tab.active {
		background: var(--bg-active);
		border-color: var(--accent);
		color: var(--text-primary);
	}

	.type-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin-bottom: 12px;
		max-height: 200px;
		overflow-y: auto;
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
