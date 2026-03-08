<script lang="ts">
	let { children } = $props();
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
