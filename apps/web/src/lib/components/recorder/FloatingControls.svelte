<script lang="ts">
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
</script>

<div class="floating-controls">
	<div class="rec-indicator" class:paused={isPaused}>
		<span class="rec-dot"></span>
		<span class="rec-label">{isPaused ? 'PAUSED' : 'REC'}</span>
	</div>

	<span class="timer">{elapsedTime}</span>

	<div class="divider"></div>

	<button class="ctrl-btn" onclick={isPaused ? onresume : onpause} title={isPaused ? 'Resume' : 'Pause'}>
		{#if isPaused}
			<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
		{:else}
			<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
		{/if}
	</button>

	<button class="ctrl-btn stop-btn" onclick={onstop} title="Stop">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
	</button>

	<button class="ctrl-btn" onclick={onrestart} title="Restart">
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
	</button>
</div>

<style>
	.floating-controls {
		position: fixed;
		bottom: 32px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px 20px;
		background: rgba(20, 20, 20, 0.9);
		backdrop-filter: blur(16px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		z-index: 9999;
	}
	.rec-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.rec-dot {
		width: 10px;
		height: 10px;
		background: #ff3333;
		border-radius: 50%;
		animation: pulse 1.5s infinite;
	}
	.paused .rec-dot { animation: none; opacity: 0.5; }
	.rec-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 1px;
		color: #ff3333;
	}
	.paused .rec-label { color: var(--text-secondary); }
	.timer {
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 500;
		min-width: 60px;
		text-align: center;
		color: white;
	}
	.divider {
		width: 1px;
		height: 20px;
		background: rgba(255, 255, 255, 0.15);
	}
	.ctrl-btn {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: white;
		cursor: pointer;
		transition: background 0.15s;
	}
	.ctrl-btn:hover { background: rgba(255, 255, 255, 0.1); }
	.stop-btn:hover { background: rgba(255, 51, 51, 0.3); color: #ff3333; }
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}
</style>
