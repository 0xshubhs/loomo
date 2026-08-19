<script lang="ts">
	import { installDiagnostics } from '$lib/desktop/diagnostics.js';
	import '../app.css';

	// Installed before anything else so a failure during startup is captured
	// too. No-op outside the desktop shell.
	installDiagnostics();

	let { children } = $props();
</script>

<svelte:head>
	<title>Loomo</title>
</svelte:head>

{@render children()}
