<script lang="ts">
	import { createAppContext } from '$lib/state/context.js';
	import { installDiagnostics } from '$lib/desktop/diagnostics.js';
	import '../app.css';

	// Installed before anything else so a failure during startup is captured
	// too. No-op outside the desktop shell.
	installDiagnostics();

	const app = createAppContext();

	let { children } = $props();
</script>

<svelte:head>
	<title>DITTOO</title>
</svelte:head>

{@render children()}
