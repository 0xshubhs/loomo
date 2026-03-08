<script lang="ts">
	import { createAppContext } from '$lib/state/context.js';
	import '../app.css';

	const app = createAppContext();

	let { children } = $props();
</script>

<svelte:head>
	<title>DITTOO</title>
</svelte:head>

{@render children()}
