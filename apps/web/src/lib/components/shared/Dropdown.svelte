<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		value?: string;
		options?: Option[];
		label?: string;
		onchange?: (value: string) => void;
	}

	let { value = $bindable(''), options = [], label = '', onchange }: Props = $props();

	function handleChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		value = target.value;
		onchange?.(value);
	}
</script>

<div class="dropdown-wrapper">
	{#if label}
		<label class="dropdown-label">{label}</label>
	{/if}
	<select class="dropdown" {value} onchange={handleChange}>
		{#each options as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
</div>

<style>
	.dropdown-wrapper {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.dropdown-label {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.dropdown {
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		padding: 4px 8px;
		height: 28px;
		color: var(--text-primary);
		cursor: pointer;
	}

	.dropdown:focus {
		border-color: var(--border-focus);
		outline: none;
	}

	.dropdown option {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}
</style>
