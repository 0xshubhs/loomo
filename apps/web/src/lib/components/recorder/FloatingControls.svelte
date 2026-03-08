<script lang="ts">
	import { onMount } from 'svelte';

	let {
		isPaused,
		elapsedTime,
		onpause,
		onresume,
		onstop,
		onrestart,
	}: {
		isPaused: boolean;
		elapsedTime: string;
		onpause: () => void;
		onresume: () => void;
		onstop: () => void;
		onrestart: () => void;
	} = $props();

	let mounted = $state(false);
	let hoveredBtn = $state<string | null>(null);

	onMount(() => {
		// Slight delay for slide-up animation
		requestAnimationFrame(() => { mounted = true; });
	});
</script>

<div class="floating-controls" class:mounted>
	<!-- Recording indicator -->
	<div class="rec-indicator" class:paused={isPaused}>
		<span class="rec-dot"></span>
		<span class="rec-label">{isPaused ? 'PAUSED' : 'REC'}</span>
	</div>

	<!-- Timer -->
	<span class="timer">{elapsedTime}</span>

	<div class="divider"></div>

	<!-- Pause/Resume -->
	<div class="btn-wrapper">
		<button
			class="ctrl-btn"
			onclick={isPaused ? onresume : onpause}
			onmouseenter={() => hoveredBtn = 'pause'}
			onmouseleave={() => hoveredBtn = null}
		>
			{#if isPaused}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<polygon points="6,3 20,12 6,21"/>
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<rect x="6" y="4" width="4" height="16" rx="1"/>
					<rect x="14" y="4" width="4" height="16" rx="1"/>
				</svg>
			{/if}
		</button>
		{#if hoveredBtn === 'pause'}
			<div class="tooltip">{isPaused ? 'Resume' : 'Pause'}</div>
		{/if}
	</div>

	<!-- Stop -->
	<div class="btn-wrapper">
		<button
			class="ctrl-btn stop-btn"
			aria-label="Stop recording"
			onclick={onstop}
			onmouseenter={() => hoveredBtn = 'stop'}
			onmouseleave={() => hoveredBtn = null}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
				<rect x="4" y="4" width="16" height="16" rx="3"/>
			</svg>
		</button>
		{#if hoveredBtn === 'stop'}
			<div class="tooltip">Stop Recording</div>
		{/if}
	</div>

	<!-- Restart -->
	<div class="btn-wrapper">
		<button
			class="ctrl-btn"
			aria-label="Restart recording"
			onclick={onrestart}
			onmouseenter={() => hoveredBtn = 'restart'}
			onmouseleave={() => hoveredBtn = null}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M1 4v6h6"/>
				<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
			</svg>
		</button>
		{#if hoveredBtn === 'restart'}
			<div class="tooltip">Restart</div>
		{/if}
	</div>
</div>

<style>
	.floating-controls {
		position: fixed;
		bottom: 32px;
		left: 50%;
		transform: translateX(-50%) translateY(80px);
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 20px;
		background: rgba(18, 18, 18, 0.85);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 24px;
		z-index: 9999;
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
		opacity: 0;
		transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
	}

	.floating-controls.mounted {
		transform: translateX(-50%) translateY(0);
		opacity: 1;
	}

	/* Recording indicator */
	.rec-indicator {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 4px 10px 4px 8px;
		background: rgba(255, 51, 51, 0.12);
		border-radius: 20px;
	}

	.rec-dot {
		width: 8px;
		height: 8px;
		background: #ff3333;
		border-radius: 50%;
		animation: recPulse 1.5s ease-in-out infinite;
		box-shadow: 0 0 8px rgba(255, 51, 51, 0.6);
	}

	.paused .rec-dot {
		animation: none;
		opacity: 0.4;
		box-shadow: none;
	}

	.rec-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 1.2px;
		color: #ff5555;
	}

	.paused .rec-label {
		color: var(--text-tertiary);
	}

	@keyframes recPulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.4; transform: scale(0.85); }
	}

	/* Timer */
	.timer {
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 600;
		min-width: 56px;
		text-align: center;
		color: white;
		letter-spacing: 0.5px;
	}

	/* Divider */
	.divider {
		width: 1px;
		height: 24px;
		background: rgba(255, 255, 255, 0.1);
	}

	/* Button wrapper for tooltip positioning */
	.btn-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Control buttons */
	.ctrl-btn {
		width: 38px;
		height: 38px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.8);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.ctrl-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.stop-btn {
		color: #ff5555;
	}

	.stop-btn:hover {
		background: rgba(255, 51, 51, 0.2);
		color: #ff6666;
	}

	/* Tooltip */
	.tooltip {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 50%;
		transform: translateX(-50%);
		padding: 5px 10px;
		background: rgba(0, 0, 0, 0.9);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		font-size: 11px;
		color: rgba(255, 255, 255, 0.9);
		white-space: nowrap;
		pointer-events: none;
		animation: tooltipIn 0.15s ease;
	}

	@keyframes tooltipIn {
		from { opacity: 0; transform: translateX(-50%) translateY(4px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}
</style>
