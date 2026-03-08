<script lang="ts">
	import { createEditorContext } from '$lib/state/context.js';

	const ctx = createEditorContext();

	let { children } = $props();
</script>

{@render children()}
