<script lang="ts">
	interface Props {
		text?: string;
		children?: import('svelte').Snippet;
	}

	let { text = '', children }: Props = $props();
</script>

<div class="tooltip-wrapper" title={text}>
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.tooltip-wrapper {
		display: inline-flex;
	}
</style>
