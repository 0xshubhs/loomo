<script lang="ts">
	import { getDashboard, getAuth } from '$lib/state/context.js';
	import { debounce } from '$lib/utils/debounce.js';
	import { relativeTime } from '$lib/utils/time.js';
	import Icon from '$lib/components/shared/Icon.svelte';
	import { goto } from '$app/navigation';

	const dashboard = getDashboard();
	const auth = getAuth();

	let searchInput = $state(dashboard.searchQuery);
	let userMenuOpen = $state(false);
	let activeMenuId = $state<string | null>(null);
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let deleteConfirmId = $state<string | null>(null);

	const debouncedSearch = debounce((q: string) => {
		dashboard.searchQuery = q;
	}, 300);

	function handleSearchInput(e: Event) {
		searchInput = (e.target as HTMLInputElement).value;
		debouncedSearch(searchInput);
	}

	function toggleVideoMenu(id: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		activeMenuId = activeMenuId === id ? null : id;
	}

	function startRename(id: string, currentTitle: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		renamingId = id;
		renameValue = currentTitle;
		activeMenuId = null;
	}

	function confirmRename() {
		if (renamingId && renameValue.trim()) {
			dashboard.updateVideo(renamingId, { title: renameValue.trim() });
		}
		renamingId = null;
		renameValue = '';
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') confirmRename();
		if (e.key === 'Escape') { renamingId = null; renameValue = ''; }
	}

	async function copyLink(id: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const video = dashboard.videos.find(v => v.id === id);
		if (video) {
			try {
				await navigator.clipboard.writeText(video.shareUrl || `${window.location.origin}/share/${id}`);
			} catch { /* ignore */ }
		}
		activeMenuId = null;
	}

	function requestDelete(id: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		deleteConfirmId = id;
		activeMenuId = null;
	}

	function confirmDelete() {
		if (deleteConfirmId) {
			dashboard.removeVideo(deleteConfirmId);
		}
		deleteConfirmId = null;
	}

	function cancelDelete() {
		deleteConfirmId = null;
	}

	function handleLogout() {
		auth.logout();
		userMenuOpen = false;
		goto('/login');
	}

	function closeMenus() {
		activeMenuId = null;
		userMenuOpen = false;
	}

	function formatDuration(ms: number | null): string {
		if (!ms) return '';
		const totalSec = Math.floor(ms / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

<svelte:window onclick={closeMenus} />

<div class="dashboard">
	<header class="header">
		<div class="header-left">
			<h1 class="logo">DITTOO</h1>
		</div>
		<div class="header-center">
			<div class="search-wrapper">
				<Icon name="search" size={14} />
				<input
					type="text"
					class="search-input"
					placeholder="Search recordings..."
					value={searchInput}
					oninput={handleSearchInput}
				/>
			</div>
		</div>
		<div class="header-right">
			<a href="/record" class="new-recording-btn">
				<span class="rec-dot"></span>
				New Recording
			</a>

			<div class="user-menu-wrapper">
				<button
					class="user-btn"
					onclick={(e) => { e.stopPropagation(); userMenuOpen = !userMenuOpen; }}
				>
					{#if auth.user?.avatarUrl}
						<img src={auth.user.avatarUrl} alt={auth.user.name} class="user-avatar" />
					{:else}
						<div class="user-avatar-fallback">
							<Icon name="user" size={16} />
						</div>
					{/if}
				</button>

				{#if userMenuOpen}
					<div class="user-dropdown" onclick={(e) => e.stopPropagation()}>
						{#if auth.user}
							<div class="user-info">
								<span class="user-name">{auth.user.name}</span>
								<span class="user-email">{auth.user.email}</span>
							</div>
							<div class="dropdown-divider"></div>
						{/if}
						<button class="dropdown-item" onclick={handleLogout}>
							<Icon name="logout" size={14} />
							Log out
						</button>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main class="content">
		{#if dashboard.filteredVideos.length === 0 && !dashboard.searchQuery}
			<div class="empty-state">
				<div class="empty-icon">
					<Icon name="camera" size={48} />
				</div>
				<h2>No recordings yet</h2>
				<p>Record your first video to get started</p>
				<a href="/record" class="cta-btn">
					<Icon name="record" size={16} />
					Record your first video
				</a>
			</div>
		{:else if dashboard.filteredVideos.length === 0 && dashboard.searchQuery}
			<div class="empty-state">
				<div class="empty-icon">
					<Icon name="search" size={48} />
				</div>
				<h2>No results found</h2>
				<p>Try a different search term</p>
			</div>
		{:else}
			<div class="video-grid">
				{#each dashboard.filteredVideos as video (video.id)}
					<a href="/share/{video.id}" class="video-card">
						<div class="thumbnail">
							{#if video.thumbnailUrl}
								<img src={video.thumbnailUrl} alt={video.title} class="thumb-img" />
								{#if video.gifUrl}
									<img src={video.gifUrl} alt="" class="thumb-gif" />
								{/if}
							{:else}
								<div class="placeholder-thumb">
									{#if video.status === 'processing'}
										<div class="processing-indicator">
											<div class="spinner-small"></div>
											<span>Processing...</span>
										</div>
									{:else}
										<Icon name="camera" size={24} />
									{/if}
								</div>
							{/if}
							{#if video.durationMs}
								<span class="duration">{formatDuration(video.durationMs)}</span>
							{/if}

							<button
								class="menu-trigger"
								onclick={(e) => toggleVideoMenu(video.id, e)}
								aria-label="Video options"
							>
								<Icon name="more" size={16} />
							</button>

							{#if activeMenuId === video.id}
								<div class="card-menu" onclick={(e) => e.preventDefault()}>
									<button class="menu-item" onclick={(e) => startRename(video.id, video.title, e)}>
										<Icon name="text" size={14} />
										Rename
									</button>
									<button class="menu-item" onclick={(e) => copyLink(video.id, e)}>
										<Icon name="copy" size={14} />
										Copy link
									</button>
									<div class="menu-divider"></div>
									<button class="menu-item danger" onclick={(e) => requestDelete(video.id, e)}>
										<Icon name="delete" size={14} />
										Delete
									</button>
								</div>
							{/if}
						</div>
						<div class="card-info">
							{#if renamingId === video.id}
								<input
									class="rename-input"
									bind:value={renameValue}
									onblur={confirmRename}
									onkeydown={handleRenameKeydown}
									onclick={(e) => e.preventDefault()}
								/>
							{:else}
								<h3 class="card-title">{video.title}</h3>
							{/if}
							<span class="card-date">{relativeTime(video.createdAt)}</span>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</main>
</div>

{#if deleteConfirmId}
	<div class="confirm-backdrop" onclick={cancelDelete} role="presentation">
		<div class="confirm-dialog" onclick={(e) => e.stopPropagation()} role="dialog">
			<h3>Delete recording?</h3>
			<p>This action cannot be undone.</p>
			<div class="confirm-actions">
				<button class="confirm-cancel" onclick={cancelDelete}>Cancel</button>
				<button class="confirm-delete" onclick={confirmDelete}>Delete</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.dashboard {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-primary);
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 32px;
		border-bottom: 1px solid var(--border-primary);
		gap: 16px;
	}
	.header-left { flex-shrink: 0; }
	.logo {
		font-size: 18px;
		font-weight: 700;
		letter-spacing: 2px;
	}
	.header-center { flex: 1; display: flex; justify-content: center; }
	.search-wrapper {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 360px;
		max-width: 100%;
		padding: 8px 16px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: 999px;
		color: var(--text-muted);
		transition: border-color var(--transition-fast);
	}
	.search-wrapper:focus-within {
		border-color: var(--border-focus);
		color: var(--text-secondary);
	}
	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-size: 13px;
	}
	.search-input::placeholder { color: var(--text-muted); }
	.header-right {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.new-recording-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 20px;
		background: var(--recording-red);
		border-radius: var(--radius-md);
		color: white;
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		transition: var(--transition-fast);
	}
	.new-recording-btn:hover { background: var(--recording-red-hover); }
	.rec-dot {
		width: 8px;
		height: 8px;
		background: white;
		border-radius: 50%;
	}

	/* User menu */
	.user-menu-wrapper { position: relative; }
	.user-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		overflow: hidden;
		cursor: pointer;
		border: 1px solid var(--border-primary);
		padding: 0;
	}
	.user-btn:hover { border-color: var(--border-secondary); }
	.user-avatar { width: 100%; height: 100%; object-fit: cover; }
	.user-avatar-fallback {
		width: 100%;
		height: 100%;
		background: var(--bg-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}
	.user-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 8px;
		min-width: 200px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		overflow: hidden;
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.user-info {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.user-name { font-size: 13px; font-weight: 500; }
	.user-email { font-size: 12px; color: var(--text-muted); }
	.dropdown-divider { height: 1px; background: var(--border-primary); }
	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 16px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: var(--transition-fast);
	}
	.dropdown-item:hover { background: var(--bg-hover); color: var(--text-primary); }

	/* Content */
	.content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 32px;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 80px 0;
	}
	.empty-icon {
		color: var(--text-muted);
		margin-bottom: 20px;
		opacity: 0.5;
	}
	.empty-state h2 { font-size: 20px; margin-bottom: 8px; }
	.empty-state p { color: var(--text-secondary); margin-bottom: 24px; }
	.cta-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 28px;
		background: var(--recording-red);
		border-radius: var(--radius-md);
		color: white;
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
	}
	.cta-btn:hover { background: var(--recording-red-hover); }

	/* Video grid */
	.video-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
	}
	@media (max-width: 1000px) { .video-grid { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 600px) { .video-grid { grid-template-columns: 1fr; } }

	.video-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		overflow: hidden;
		cursor: pointer;
		transition: var(--transition-fast);
		text-decoration: none;
		color: inherit;
	}
	.video-card:hover { border-color: var(--border-secondary); }
	.video-card:hover .thumb-gif { opacity: 1; }
	.video-card:hover .menu-trigger { opacity: 1; }

	.thumbnail {
		aspect-ratio: 16/9;
		background: var(--bg-tertiary);
		position: relative;
		overflow: hidden;
	}
	.thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.thumb-gif {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 0.2s;
	}
	.placeholder-thumb {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}
	.processing-indicator {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.spinner-small {
		width: 24px;
		height: 24px;
		border: 2px solid var(--border-primary);
		border-top-color: var(--text-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.duration {
		position: absolute;
		bottom: 6px;
		right: 6px;
		background: rgba(0, 0, 0, 0.8);
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 11px;
		font-family: var(--font-mono);
		color: white;
	}
	.menu-trigger {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		border: none;
		border-radius: var(--radius-sm);
		color: white;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--transition-fast);
	}
	.menu-trigger:hover { background: rgba(0, 0, 0, 0.8); }

	/* Card dropdown menu */
	.card-menu {
		position: absolute;
		top: 38px;
		right: 6px;
		min-width: 160px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		overflow: hidden;
		z-index: 50;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: var(--transition-fast);
	}
	.menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
	.menu-item.danger { color: var(--danger); }
	.menu-item.danger:hover { background: rgba(255, 68, 68, 0.1); }
	.menu-divider { height: 1px; background: var(--border-primary); margin: 2px 0; }

	.card-info { padding: 12px; }
	.card-title {
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 4px;
	}
	.card-date {
		font-size: 12px;
		color: var(--text-muted);
	}
	.rename-input {
		width: 100%;
		padding: 4px 8px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-focus);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 500;
		outline: none;
		margin-bottom: 4px;
	}

	/* Delete confirmation dialog */
	.confirm-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.confirm-dialog {
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		padding: 24px;
		min-width: 320px;
		text-align: center;
	}
	.confirm-dialog h3 { font-size: 16px; margin-bottom: 8px; }
	.confirm-dialog p { font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; }
	.confirm-actions { display: flex; gap: 10px; justify-content: center; }
	.confirm-cancel {
		padding: 8px 20px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 13px;
		cursor: pointer;
	}
	.confirm-cancel:hover { background: var(--bg-hover); }
	.confirm-delete {
		padding: 8px 20px;
		background: var(--danger);
		border: none;
		border-radius: var(--radius-md);
		color: white;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.confirm-delete:hover { opacity: 0.9; }
</style>
