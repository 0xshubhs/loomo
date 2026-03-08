<script lang="ts">
	import { getAuth } from '$lib/state/context.js';
	import { goto } from '$app/navigation';

	const auth = getAuth();
	let { children } = $props();

	$effect(() => {
		auth.loadSession();
	});

	$effect(() => {
		if (!auth.loading && auth.isAuthenticated) {
			goto('/');
		}
	});
</script>

<div class="auth-wrapper">
	{@render children()}
</div>

<style>
	.auth-wrapper {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
	}
</style>
