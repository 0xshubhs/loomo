<script lang="ts">
	let { value }: { value: number } = $props();

	let displayText = $derived(value > 0 ? String(value) : 'GO');
</script>

{#if value >= 0}
	<div class="countdown-overlay">
		<!-- Pulse rings -->
		{#key value}
			<div class="ring-container">
				<div class="pulse-ring ring-1"></div>
				<div class="pulse-ring ring-2"></div>
				<div class="pulse-ring ring-3"></div>
			</div>
			<span class="count" class:go={value === 0}>{displayText}</span>
		{/key}
	</div>
{/if}

<style>
	.countdown-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
	}

	.ring-container {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.pulse-ring {
		position: absolute;
		border-radius: 50%;
		border: 2px solid rgba(255, 51, 51, 0.3);
		animation: ringExpand 1s ease-out forwards;
	}

	.ring-1 {
		width: 120px;
		height: 120px;
		animation-delay: 0s;
	}

	.ring-2 {
		width: 120px;
		height: 120px;
		animation-delay: 0.15s;
	}

	.ring-3 {
		width: 120px;
		height: 120px;
		animation-delay: 0.3s;
	}

	@keyframes ringExpand {
		0% {
			transform: scale(0.8);
			opacity: 0.6;
			border-color: rgba(255, 51, 51, 0.5);
		}
		100% {
			transform: scale(3);
			opacity: 0;
			border-color: rgba(255, 51, 51, 0);
		}
	}

	.count {
		position: relative;
		font-size: 140px;
		font-weight: 700;
		color: white;
		animation: countAnim 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		text-shadow: 0 0 60px rgba(255, 51, 51, 0.3);
		z-index: 1;
	}

	.count.go {
		font-size: 80px;
		letter-spacing: 8px;
		color: #ff5555;
		text-shadow: 0 0 40px rgba(255, 51, 51, 0.5);
	}

	@keyframes countAnim {
		0% {
			transform: scale(2);
			opacity: 0;
			filter: blur(8px);
		}
		30% {
			transform: scale(1);
			opacity: 1;
			filter: blur(0);
		}
		70% {
			transform: scale(1);
			opacity: 1;
			filter: blur(0);
		}
		100% {
			transform: scale(0.85);
			opacity: 0;
			filter: blur(4px);
		}
	}
</style>
