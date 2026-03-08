<script lang="ts">
	interface Props {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		label?: string;
		oninput?: (value: number) => void;
	}

	let { value = $bindable(0), min = 0, max = 100, step = 1, label = '', oninput }: Props = $props();

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		value = parseFloat(target.value);
		oninput?.(value);
	}
</script>

<div class="slider-wrapper">
	{#if label}
		<label class="slider-label">{label}</label>
	{/if}
	<input
		type="range"
		{min}
		{max}
		{step}
		{value}
		oninput={handleInput}
		class="slider"
	/>
	<span class="slider-value">{value}</span>
</div>

<style>
	.slider-wrapper {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.slider-label {
		font-size: 11px;
		color: var(--text-tertiary);
		min-width: 50px;
	}

	.slider {
		flex: 1;
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		background: var(--bg-hover);
		border-radius: 2px;
		outline: none;
	}

	.slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--text-primary);
		cursor: pointer;
	}

	.slider-value {
		font-size: 11px;
		color: var(--text-tertiary);
		min-width: 30px;
		text-align: right;
		font-family: var(--font-mono);
	}
</style>
