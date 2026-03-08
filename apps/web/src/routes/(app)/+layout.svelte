<script lang="ts">
	import { getAuth } from '$lib/state/context.js';
	import { goto } from '$app/navigation';

	const auth = getAuth();

	let { children } = $props();

	$effect(() => {
		if (!auth.loading && !auth.isAuthenticated) {
			goto('/login');
		}
	});

	$effect(() => {
		auth.loadSession();
	});
</script>

{#if auth.loading}
	<div class="loading-screen">
		<div class="spinner"></div>
	</div>
{:else if auth.isAuthenticated}
	{@render children()}
{/if}

<style>
	.loading-screen {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border-primary);
		border-top-color: var(--text-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
