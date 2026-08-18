<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { generateId } from '$lib/utils/id.js';

	/**
	 * Starting a new project.
	 *
	 * The id is minted here rather than at the first save, so there is exactly
	 * one editor route to maintain. Until something is written, the id simply
	 * has no project behind it — opening it finds nothing and starts empty.
	 */
	onMount(() => {
		goto(`/edit/${generateId()}`, { replaceState: true });
	});
</script>

<div class="starting">Starting a new project…</div>

<style>
	.starting {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
