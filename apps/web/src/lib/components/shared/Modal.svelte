<script lang="ts">
	interface Props {
		open?: boolean;
		title?: string;
		onclose?: () => void;
		children?: import('svelte').Snippet;
	}

	let { open = $bindable(false), title = '', onclose, children }: Props = $props();

	function handleBackdrop() {
		open = false;
		onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
			onclose?.();
		}
	}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<div class="modal-backdrop" onclick={handleBackdrop} role="presentation">
		<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="modal-header">
				<h3>{title}</h3>
				<button class="modal-close" onclick={handleBackdrop}>&times;</button>
			</div>
			<div class="modal-body">
				{#if children}
					{@render children()}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		min-width: 400px;
		max-width: 600px;
		max-height: 80vh;
		overflow: auto;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border-primary);
	}

	.modal-header h3 {
		font-size: 14px;
		font-weight: 600;
	}

	.modal-close {
		font-size: 20px;
		color: var(--text-tertiary);
		padding: 0 4px;
		line-height: 1;
	}

	.modal-close:hover {
		color: var(--text-primary);
	}

	.modal-body {
		padding: 20px;
	}
</style>
