<script lang="ts">
	/**
	 * Right-click menu.
	 *
	 * The editor had no context menu at all, so operations that already existed
	 * as commands — closing a gap, trimming to the playhead, splitting — were
	 * only reachable from a toolbar icon or a keyboard shortcut, i.e. invisible.
	 */
	export interface MenuItem {
		label: string;
		shortcut?: string;
		danger?: boolean;
		disabled?: boolean;
		action: () => void;
	}

	export type MenuEntry = MenuItem | 'separator';

	interface Props {
		x: number;
		y: number;
		items: MenuEntry[];
		onclose: () => void;
	}

	let { x, y, items, onclose }: Props = $props();

	let menuEl = $state<HTMLDivElement | null>(null);

	// Keep the menu on screen when opened near an edge.
	let position = $derived.by(() => {
		const width = 220;
		const height = Math.min(items.length * 30 + 12, 420);
		const maxX = typeof window !== 'undefined' ? window.innerWidth - width - 8 : x;
		const maxY = typeof window !== 'undefined' ? window.innerHeight - height - 8 : y;
		return { left: Math.max(8, Math.min(x, maxX)), top: Math.max(8, Math.min(y, maxY)) };
	});

	function run(item: MenuItem) {
		if (item.disabled) return;
		onclose();
		item.action();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Full-screen catcher so any click outside dismisses the menu. -->
<div
	class="scrim"
	role="presentation"
	onpointerdown={onclose}
	oncontextmenu={(e) => {
		e.preventDefault();
		onclose();
	}}
></div>

<div
	class="menu"
	bind:this={menuEl}
	style="left: {position.left}px; top: {position.top}px;"
	role="menu"
	tabindex="-1"
>
	{#each items as item, index}
		{#if item === 'separator'}
			<div class="separator" role="separator"></div>
		{:else}
			<button
				class="item"
				class:danger={item.danger}
				disabled={item.disabled}
				role="menuitem"
				onclick={() => run(item)}
			>
				<span class="label">{item.label}</span>
				{#if item.shortcut}
					<span class="shortcut">{item.shortcut}</span>
				{/if}
			</button>
		{/if}
	{/each}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 900;
	}

	.menu {
		position: fixed;
		z-index: 901;
		min-width: 220px;
		padding: 5px;
		border-radius: 8px;
		background: #1c1c1f;
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
	}

	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		width: 100%;
		padding: 6px 9px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--text-primary);
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}

	.item:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.09);
	}

	.item:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.item.danger:hover:not(:disabled) {
		background: rgba(255, 68, 68, 0.16);
		color: #ff6b6b;
	}

	.shortcut {
		font-size: 10px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.separator {
		height: 1px;
		margin: 4px 6px;
		background: rgba(255, 255, 255, 0.09);
	}
</style>
