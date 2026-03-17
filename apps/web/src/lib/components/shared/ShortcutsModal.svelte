<script lang="ts">
	import { getShortcutsByCategory } from '$lib/utils/keyboard.js';
	import type { Shortcut } from '$lib/utils/keyboard.js';

	interface Props {
		open?: boolean;
		onclose?: () => void;
	}

	let { open = $bindable(false), onclose }: Props = $props();

	let searchQuery = $state('');
	let searchInput: HTMLInputElement | undefined = $state();
	let modalEl: HTMLDivElement | undefined = $state();

	const allCategories = getShortcutsByCategory();

	const filteredCategories = $derived(() => {
		if (!searchQuery.trim()) return allCategories;
		const q = searchQuery.toLowerCase().trim();
		return allCategories
			.map((cat) => ({
				...cat,
				shortcuts: cat.shortcuts.filter(
					(s) =>
						s.description.toLowerCase().includes(q) ||
						s.label.toLowerCase().includes(q) ||
						s.action.toLowerCase().includes(q)
				),
			}))
			.filter((cat) => cat.shortcuts.length > 0);
	});

	function close() {
		open = false;
		searchQuery = '';
		onclose?.();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			close();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
		// Trap focus inside modal
		if (e.key === 'Tab' && modalEl) {
			const focusable = modalEl.querySelectorAll<HTMLElement>(
				'input, button, [tabindex]:not([tabindex="-1"])'
			);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last?.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first?.focus();
			}
		}
	}

	function parseLabel(label: string): string[] {
		return label.split('+');
	}

	$effect(() => {
		if (open && searchInput) {
			// Use tick-like delay so the element is rendered
			requestAnimationFrame(() => searchInput?.focus());
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="shortcuts-backdrop" onclick={handleBackdropClick} role="presentation">
		<div class="shortcuts-modal" bind:this={modalEl} role="dialog" aria-label="Keyboard shortcuts">
			<div class="modal-header">
				<h2>Keyboard Shortcuts</h2>
				<button class="close-btn" onclick={close} aria-label="Close">&times;</button>
			</div>

			<div class="search-bar">
				<input
					bind:this={searchInput}
					bind:value={searchQuery}
					type="text"
					placeholder="Search shortcuts..."
					class="search-input"
				/>
			</div>

			<div class="shortcuts-body">
				{#each filteredCategories() as group}
					<div class="category">
						<h3 class="category-title">{group.label}</h3>
						<div class="shortcuts-list">
							{#each group.shortcuts as shortcut}
								<div class="shortcut-row">
									<span class="shortcut-description">{shortcut.description}</span>
									<span class="shortcut-keys">
										{#each parseLabel(shortcut.label) as part, i}
											{#if i > 0}<span class="key-separator">+</span>{/if}
											<kbd>{part}</kbd>
										{/each}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}

				{#if filteredCategories().length === 0}
					<div class="no-results">
						No shortcuts match "{searchQuery}"
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.shortcuts-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1100;
		animation: fadeIn 0.15s ease;
	}

	.shortcuts-modal {
		background: rgba(17, 17, 17, 0.95);
		backdrop-filter: blur(20px);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		width: 640px;
		max-width: 90vw;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		animation: slideUp 0.2s ease;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border-primary);
		flex-shrink: 0;
	}

	.modal-header h2 {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.close-btn {
		font-size: 22px;
		color: var(--text-tertiary);
		padding: 0 4px;
		line-height: 1;
		background: none;
		border: none;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: color var(--transition-fast);
	}

	.close-btn:hover {
		color: var(--text-primary);
	}

	.search-bar {
		padding: 12px 20px;
		border-bottom: 1px solid var(--border-primary);
		flex-shrink: 0;
	}

	.search-input {
		width: 100%;
		padding: 8px 12px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 13px;
		font-family: var(--font-sans);
		outline: none;
		transition: border-color var(--transition-fast);
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	.search-input:focus {
		border-color: var(--border-focus);
	}

	.shortcuts-body {
		overflow-y: auto;
		padding: 8px 20px 20px;
		flex: 1;
		min-height: 0;
	}

	.category {
		margin-top: 16px;
	}

	.category:first-child {
		margin-top: 8px;
	}

	.category-title {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: var(--text-muted);
		margin-bottom: 8px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--border-primary);
	}

	.shortcuts-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast);
	}

	.shortcut-row:hover {
		background: var(--bg-hover);
	}

	.shortcut-description {
		font-size: 13px;
		color: var(--text-secondary);
	}

	.shortcut-keys {
		display: flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
		margin-left: 16px;
	}

	.key-separator {
		font-size: 10px;
		color: var(--text-muted);
	}

	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		padding: 0 6px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-secondary);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-primary);
		box-shadow: 0 1px 0 var(--border-primary);
		white-space: nowrap;
	}

	.no-results {
		text-align: center;
		padding: 32px 0;
		color: var(--text-muted);
		font-size: 13px;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideUp {
		from { transform: translateY(10px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
</style>
