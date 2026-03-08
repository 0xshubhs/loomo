<script lang="ts">
	interface Props {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		disabled?: boolean;
		active?: boolean;
		title?: string;
		onclick?: (e: MouseEvent) => void;
		children?: import('svelte').Snippet;
	}

	let { variant = 'secondary', size = 'md', disabled = false, active = false, title = '', onclick, children }: Props = $props();
</script>

<button
	class="btn btn-{variant} btn-{size}"
	class:active
	{disabled}
	{title}
	onclick={onclick}
>
	{#if children}
		{@render children()}
	{/if}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
		font-weight: 500;
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-sm { padding: 2px 8px; font-size: 11px; height: 24px; }
	.btn-md { padding: 4px 12px; font-size: 12px; height: 28px; }
	.btn-lg { padding: 6px 16px; font-size: 13px; height: 32px; }

	.btn-primary {
		background: var(--text-primary);
		color: var(--bg-primary);
	}
	.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

	.btn-secondary {
		background: var(--bg-surface);
		color: var(--text-secondary);
		border-color: var(--border-primary);
	}
	.btn-secondary:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }

	.btn-ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }

	.btn-danger {
		background: transparent;
		color: var(--danger);
		border-color: var(--danger);
	}
	.btn-danger:hover:not(:disabled) { background: var(--danger); color: white; }

	.active {
		background: var(--bg-active) !important;
		color: var(--text-primary) !important;
	}
</style>
