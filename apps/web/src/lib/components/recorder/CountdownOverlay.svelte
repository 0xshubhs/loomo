<script lang="ts">
	let { value }: { value: number } = $props();
</script>

{#if value > 0}
	<div class="countdown-overlay">
		{#key value}
			<span class="count">{value}</span>
		{/key}
	</div>
{/if}

<style>
	.countdown-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
	}
	.count {
		font-size: 120px;
		font-weight: 700;
		color: white;
		animation: countPulse 1s ease-out;
	}
	@keyframes countPulse {
		0% { transform: scale(1.5); opacity: 0; }
		50% { transform: scale(1); opacity: 1; }
		100% { transform: scale(0.8); opacity: 0.5; }
	}
</style>
