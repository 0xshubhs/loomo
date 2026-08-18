<script lang="ts">
	import type { LocalProjectMeta } from '$lib/desktop/projects.js';

	/**
	 * The project library.
	 *
	 * This is the app's home. Everything here is stored on disk in the user's
	 * own folder — there is no account, no upload and nothing to sign into.
	 */

	interface Props {
		projects: LocalProjectMeta[];
		loading: boolean;
		error: string | null;
		onnew: () => void;
		onopen: (id: string) => void;
		onrename: (id: string, name: string) => void;
		ondelete: (id: string) => void;
	}

	let { projects, loading, error, onnew, onopen, onrename, ondelete }: Props = $props();

	let search = $state('');
	let renaming = $state<string | null>(null);
	let renameValue = $state('');
	let confirmingDelete = $state<string | null>(null);

	let visible = $derived(
		search.trim()
			? projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
			: projects
	);

	function startRename(project: LocalProjectMeta) {
		renaming = project.id;
		renameValue = project.name;
	}

	function commitRename() {
		const id = renaming;
		renaming = null;
		if (id && renameValue.trim()) onrename(id, renameValue.trim());
	}

	function formatDuration(seconds: number): string {
		if (!seconds || seconds <= 0) return '—';
		const total = Math.round(seconds);
		const minutes = Math.floor(total / 60);
		return `${minutes}:${String(total % 60).padStart(2, '0')}`;
	}

	/** Relative for anything recent, absolute once "3 days ago" stops helping. */
	function formatEdited(timestamp: number): string {
		if (!timestamp) return 'Never opened';
		const elapsed = Date.now() - timestamp;
		const minute = 60_000;
		const hour = 60 * minute;
		const day = 24 * hour;

		if (elapsed < minute) return 'Just now';
		if (elapsed < hour) return `${Math.floor(elapsed / minute)} min ago`;
		if (elapsed < day) return `${Math.floor(elapsed / hour)} h ago`;
		if (elapsed < 7 * day) return `${Math.floor(elapsed / day)} d ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	function formatSize(bytes: number): string {
		if (!bytes) return '';
		const mb = bytes / (1024 * 1024);
		return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
	}
</script>

<div class="library">
	<header class="header">
		<div class="title-row">
			<h1>Projects</h1>
			<input class="search" type="search" placeholder="Search projects" bind:value={search} />
		</div>
	</header>

	{#if error}
		<div class="banner error">{error}</div>
	{/if}

	<div class="grid">
		<button class="tile new" onclick={onnew}>
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<line x1="12" y1="5" x2="12" y2="19" />
				<line x1="5" y1="12" x2="19" y2="12" />
			</svg>
			<span>New project</span>
		</button>

		{#each visible as project (project.id)}
			<div class="tile project">
				<button class="thumb" onclick={() => onopen(project.id)} title="Open {project.name}">
					{#if project.thumbnail}
						<img src={project.thumbnail} alt="" />
					{:else}
						<div class="thumb-empty">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<rect x="2" y="4" width="20" height="16" rx="2" />
								<polygon points="10 9 15 12 10 15" fill="currentColor" stroke="none" />
							</svg>
						</div>
					{/if}
					<span class="duration">{formatDuration(project.duration)}</span>
				</button>

				<div class="meta">
					{#if renaming === project.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="rename"
							bind:value={renameValue}
							autofocus
							onblur={commitRename}
							onkeydown={(e) => {
								if (e.key === 'Enter') commitRename();
								if (e.key === 'Escape') renaming = null;
							}}
						/>
					{:else}
						<button class="name" onclick={() => onopen(project.id)}>{project.name}</button>
					{/if}
					<div class="sub">
						<span>{formatEdited(project.updatedAt)}</span>
						{#if project.sizeBytes}<span>· {formatSize(project.sizeBytes)}</span>{/if}
					</div>
				</div>

				<div class="actions">
					<button onclick={() => startRename(project)} title="Rename">Rename</button>
					<button class="danger" onclick={() => (confirmingDelete = project.id)} title="Delete">Delete</button>
				</div>
			</div>
		{/each}
	</div>

	{#if loading}
		<p class="hint">Loading projects…</p>
	{:else if projects.length === 0}
		<p class="hint">No projects yet. Start one and it will appear here.</p>
	{:else if visible.length === 0}
		<p class="hint">Nothing matches “{search}”.</p>
	{/if}
</div>

{#if confirmingDelete}
	<!-- Deleting takes the project's media copies with it, which is not
	     something to do on a stray click. -->
	<div class="backdrop">
		<div class="dialog">
			<h3>Delete this project?</h3>
			<p>The project and its copies of the media will be removed from disk. Your original files are not touched.</p>
			<div class="dialog-actions">
				<button class="ghost" onclick={() => (confirmingDelete = null)}>Cancel</button>
				<button
					class="primary danger"
					onclick={() => {
						const id = confirmingDelete!;
						confirmingDelete = null;
						ondelete(id);
					}}
				>
					Delete
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.library {
		padding: 24px 28px 48px;
		height: 100%;
		overflow-y: auto;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 20px;
	}

	h1 {
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.search {
		width: 220px;
		padding: 6px 10px;
		border: 1px solid var(--border-primary);
		border-radius: 6px;
		background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
		color: var(--text-primary);
		font-size: 12px;
	}

	.banner.error {
		margin-bottom: 16px;
		padding: 10px 12px;
		border: 1px solid rgba(255, 90, 90, 0.4);
		border-radius: 8px;
		background: rgba(255, 90, 90, 0.08);
		color: var(--text-primary);
		font-size: 12px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 16px;
	}

	.tile {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-primary);
		border-radius: 10px;
		background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
		overflow: hidden;
	}

	.tile.new {
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 170px;
		border-style: dashed;
		color: var(--text-secondary);
		font-size: 12px;
		cursor: pointer;
	}

	.tile.new:hover {
		border-color: var(--accent-primary, #ff5f45);
		color: var(--text-primary);
	}

	.thumb {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: none;
		background: #000;
		cursor: pointer;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb-empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-muted);
	}

	.duration {
		position: absolute;
		right: 6px;
		bottom: 6px;
		padding: 1px 5px;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		font-size: 10px;
	}

	.meta {
		padding: 10px 10px 4px;
	}

	.name {
		display: block;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 12px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rename {
		width: 100%;
		padding: 2px 4px;
		border: 1px solid var(--accent-primary, #ff5f45);
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.3);
		color: var(--text-primary);
		font-size: 12px;
	}

	.sub {
		margin-top: 2px;
		color: var(--text-muted);
		font-size: 10px;
	}

	.actions {
		display: flex;
		gap: 4px;
		padding: 6px 8px 8px;
	}

	.actions button {
		padding: 3px 8px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 10px;
		cursor: pointer;
	}

	.actions button:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}

	.actions .danger:hover {
		color: #ff7a59;
	}

	.hint {
		margin-top: 20px;
		color: var(--text-muted);
		font-size: 12px;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.6);
		z-index: 10000;
	}

	.dialog {
		width: 340px;
		padding: 20px;
		border: 1px solid var(--border-primary);
		border-radius: 10px;
		background: var(--bg-secondary, #1a1a1a);
	}

	.dialog h3 {
		margin: 0 0 6px;
		font-size: 14px;
		color: var(--text-primary);
	}

	.dialog p {
		margin: 0 0 16px;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.dialog-actions button {
		padding: 6px 12px;
		border: 1px solid var(--border-primary);
		border-radius: 6px;
		background: transparent;
		color: var(--text-primary);
		font-size: 12px;
		cursor: pointer;
	}

	.dialog-actions .primary {
		border-color: transparent;
		background: var(--accent-primary, #ff5f45);
		color: #fff;
	}

	.dialog-actions .primary.danger {
		background: #e5484d;
	}
</style>
