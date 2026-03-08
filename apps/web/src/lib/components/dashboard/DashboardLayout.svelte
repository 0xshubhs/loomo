<script lang="ts">
	import { getDashboard, getAuth } from '$lib/state/context.js';
	import { debounce } from '$lib/utils/debounce.js';
	import { relativeTime } from '$lib/utils/time.js';
	import Icon from '$lib/components/shared/Icon.svelte';
	import { goto } from '$app/navigation';

	let { ondelete, onrename }: {
		ondelete?: (id: string) => void;
		onrename?: (id: string, title: string) => void;
	} = $props();

	const dashboard = getDashboard();
	const auth = getAuth();

	let searchInput = $state(dashboard.searchQuery);
	let userMenuOpen = $state(false);
	let activeMenuId = $state<string | null>(null);
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let deleteConfirmId = $state<string | null>(null);
	let viewMode = $state<'grid' | 'list'>('grid');
	let searchFocused = $state(false);

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
			onrename?.(renamingId, renameValue.trim());
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
			ondelete?.(deleteConfirmId);
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

	let videoCount = $derived(dashboard.filteredVideos.length);
</script>

<svelte:window onclick={closeMenus} />

<div class="dashboard">
	<!-- Header / Navbar -->
	<header class="header">
		<div class="header-left">
			<a href="/" class="logo-link">
				<span class="logo">DITTOO</span>
			</a>
		</div>

		<div class="header-center">
			<div class="search-wrapper" class:search-focused={searchFocused}>
				<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
				</svg>
				<input
					type="text"
					class="search-input"
					placeholder="Search recordings..."
					value={searchInput}
					oninput={handleSearchInput}
					onfocus={() => searchFocused = true}
					onblur={() => searchFocused = false}
				/>
				{#if searchInput}
					<button
						class="search-clear"
						onclick={() => { searchInput = ''; dashboard.searchQuery = ''; }}
						aria-label="Clear search"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
							<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
						</svg>
					</button>
				{/if}
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
					aria-label="User menu"
				>
					{#if auth.user?.avatarUrl}
						<img src={auth.user.avatarUrl} alt={auth.user.name} class="user-avatar" />
					{:else}
						<div class="user-avatar-fallback">
							{#if auth.user?.name}
								<span class="avatar-initial">{auth.user.name.charAt(0).toUpperCase()}</span>
							{:else}
								<Icon name="user" size={16} />
							{/if}
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

	<!-- Main Content -->
	<main class="content">
		<!-- Section Header -->
		{#if !dashboard.loading && (dashboard.filteredVideos.length > 0 || dashboard.searchQuery)}
			<div class="section-header">
				<div class="section-title-row">
					<h2 class="section-title">Library</h2>
					{#if videoCount > 0}
						<span class="video-count">{videoCount} {videoCount === 1 ? 'video' : 'videos'}</span>
					{/if}
				</div>
				<div class="view-toggle">
					<button
						class="view-toggle-btn"
						class:active={viewMode === 'grid'}
						onclick={() => viewMode = 'grid'}
						aria-label="Grid view"
					>
						<Icon name="grid" size={16} />
					</button>
					<button
						class="view-toggle-btn"
						class:active={viewMode === 'list'}
						onclick={() => viewMode = 'list'}
						aria-label="List view"
					>
						<Icon name="list" size={16} />
					</button>
				</div>
			</div>
		{/if}

		<!-- Loading State: Skeleton Cards -->
		{#if dashboard.loading}
			<div class="section-header">
				<div class="section-title-row">
					<h2 class="section-title">Library</h2>
				</div>
			</div>
			<div class="video-grid">
				{#each Array(6) as _}
					<div class="skeleton-card">
						<div class="skeleton-thumb">
							<div class="shimmer"></div>
						</div>
						<div class="skeleton-info">
							<div class="skeleton-title">
								<div class="shimmer"></div>
							</div>
							<div class="skeleton-date">
								<div class="shimmer"></div>
							</div>
						</div>
					</div>
				{/each}
			</div>

		<!-- Empty State: No recordings -->
		{:else if dashboard.filteredVideos.length === 0 && !dashboard.searchQuery}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
						<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
					</svg>
				</div>
				<h2 class="empty-title">No recordings yet</h2>
				<p class="empty-subtitle">Create your first recording to get started</p>
				<a href="/record" class="cta-btn">
					<span class="cta-dot"></span>
					Record a video
				</a>
			</div>

		<!-- Empty State: No search results -->
		{:else if dashboard.filteredVideos.length === 0 && dashboard.searchQuery}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
						<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
					</svg>
				</div>
				<h2 class="empty-title">No results found</h2>
				<p class="empty-subtitle">Try a different search term</p>
			</div>

		<!-- Video Grid -->
		{:else}
			<div class="video-grid" class:list-view={viewMode === 'list'}>
				{#each dashboard.filteredVideos as video (video.id)}
					<a href="/share/{video.id}" class="video-card" class:list-card={viewMode === 'list'}>
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
											<div class="spinner"></div>
											<span>Processing...</span>
										</div>
									{:else}
										<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
											<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
										</svg>
									{/if}
								</div>
							{/if}

							<!-- Gradient overlay for duration -->
							<div class="thumb-gradient"></div>

							<!-- Duration badge -->
							{#if video.durationMs}
								<span class="duration">{formatDuration(video.durationMs)}</span>
							{/if}

							<!-- Play button overlay on hover -->
							<div class="play-overlay">
								<div class="play-btn">
									<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
										<path d="M8 5v14l11-7z"/>
									</svg>
								</div>
							</div>

							<!-- Three-dot menu -->
							<button
								class="menu-trigger"
								onclick={(e) => toggleVideoMenu(video.id, e)}
								aria-label="Video options"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
								</svg>
							</button>

							<!-- Card dropdown menu -->
							{#if activeMenuId === video.id}
								<div class="card-menu" onclick={(e) => e.preventDefault()}>
									<button class="menu-item" onclick={(e) => startRename(video.id, video.title, e)}>
										<Icon name="text" size={14} />
										<span>Rename</span>
									</button>
									<button class="menu-item" onclick={(e) => copyLink(video.id, e)}>
										<Icon name="link" size={14} />
										<span>Copy link</span>
									</button>
									<button class="menu-item" onclick={() => {}}>
										<Icon name="globe" size={14} />
										<span>Share settings</span>
									</button>
									<div class="menu-divider"></div>
									<button class="menu-item danger" onclick={(e) => requestDelete(video.id, e)}>
										<Icon name="delete" size={14} />
										<span>Delete</span>
									</button>
								</div>
							{/if}
						</div>
						<div class="card-info">
							{#if renamingId === video.id}
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="rename-input"
									bind:value={renameValue}
									onblur={confirmRename}
									onkeydown={handleRenameKeydown}
									onclick={(e) => e.preventDefault()}
									autofocus
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

<!-- Delete Confirmation Modal -->
{#if deleteConfirmId}
	<div class="modal-backdrop" onclick={cancelDelete} role="presentation">
		<div class="modal-dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
			<div class="modal-header">
				<h3 class="modal-title">Delete recording?</h3>
			</div>
			<p class="modal-description">This recording will be permanently deleted. This action cannot be undone.</p>
			<div class="modal-actions">
				<button class="btn-cancel" onclick={cancelDelete}>Cancel</button>
				<button class="btn-delete" onclick={confirmDelete}>Delete</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ============================
	   Dashboard Container
	   ============================ */
	.dashboard {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-primary);
	}

	/* ============================
	   Header / Navbar
	   ============================ */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 32px;
		height: 64px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		background: var(--bg-primary);
		position: sticky;
		top: 0;
		z-index: 50;
		backdrop-filter: blur(12px);
		gap: 24px;
	}

	.header-left {
		flex-shrink: 0;
	}

	.logo-link {
		text-decoration: none;
		color: inherit;
	}

	.logo {
		font-size: 18px;
		font-weight: 800;
		letter-spacing: 3px;
		color: var(--text-primary);
		user-select: none;
	}

	/* Search */
	.header-center {
		flex: 1;
		display: flex;
		justify-content: center;
		max-width: 480px;
	}

	.search-wrapper {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 9px 18px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 999px;
		color: var(--text-muted);
		transition: all 0.2s ease;
	}

	.search-wrapper:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.12);
	}

	.search-wrapper.search-focused {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.2);
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.04);
	}

	.search-icon {
		flex-shrink: 0;
		opacity: 0.4;
	}

	.search-focused .search-icon {
		opacity: 0.6;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-size: 13px;
		line-height: 1.4;
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	.search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.1);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.search-clear:hover {
		background: rgba(255, 255, 255, 0.16);
		color: var(--text-primary);
	}

	/* Header Right */
	.header-right {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-shrink: 0;
	}

	.new-recording-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 22px;
		background: var(--recording-red);
		border-radius: 999px;
		color: white;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s ease;
		box-shadow: 0 2px 8px rgba(255, 51, 51, 0.25);
		letter-spacing: 0.01em;
	}

	.new-recording-btn:hover {
		background: var(--recording-red-hover);
		box-shadow: 0 4px 16px rgba(255, 51, 51, 0.35);
		transform: translateY(-1px);
	}

	.new-recording-btn:active {
		transform: translateY(0);
		box-shadow: 0 2px 6px rgba(255, 51, 51, 0.2);
	}

	.rec-dot {
		width: 8px;
		height: 8px;
		background: white;
		border-radius: 50%;
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	/* User Menu */
	.user-menu-wrapper {
		position: relative;
	}

	.user-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		overflow: hidden;
		cursor: pointer;
		border: 2px solid transparent;
		padding: 0;
		transition: all 0.2s ease;
	}

	.user-btn:hover {
		border-color: rgba(255, 255, 255, 0.15);
	}

	.user-btn:focus-visible {
		border-color: rgba(255, 255, 255, 0.3);
		outline: none;
	}

	.user-avatar {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.user-avatar-fallback {
		width: 100%;
		height: 100%;
		background: linear-gradient(135deg, #333 0%, #444 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
	}

	.avatar-initial {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.user-dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 220px;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		overflow: hidden;
		z-index: 100;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3);
		animation: dropdown-enter 0.15s ease-out;
	}

	@keyframes dropdown-enter {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.user-info {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.user-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.user-email {
		font-size: 12px;
		color: var(--text-tertiary);
	}

	.dropdown-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
	}

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
		transition: all 0.12s ease;
	}

	.dropdown-item:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}

	/* ============================
	   Main Content
	   ============================ */
	.content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 40px 40px 80px;
	}

	/* Section Header */
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 28px;
	}

	.section-title-row {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	.section-title {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-primary);
	}

	.video-count {
		font-size: 13px;
		color: var(--text-tertiary);
		font-weight: 400;
	}

	/* View Toggle */
	.view-toggle {
		display: flex;
		align-items: center;
		gap: 2px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 8px;
		padding: 3px;
	}

	.view-toggle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 28px;
		border-radius: 6px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.view-toggle-btn:hover {
		color: var(--text-secondary);
	}

	.view-toggle-btn.active {
		background: rgba(255, 255, 255, 0.1);
		color: var(--text-primary);
	}

	/* ============================
	   Video Grid
	   ============================ */
	.video-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
	}

	.video-grid.list-view {
		grid-template-columns: 1fr;
		gap: 8px;
	}

	@media (max-width: 1000px) {
		.video-grid:not(.list-view) {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 600px) {
		.video-grid:not(.list-view) {
			grid-template-columns: 1fr;
		}
		.content {
			padding: 24px 20px 60px;
		}
		.header {
			padding: 0 16px;
		}
	}

	/* ============================
	   Video Card
	   ============================ */
	.video-card {
		display: block;
		background: transparent;
		border-radius: 12px;
		overflow: hidden;
		cursor: pointer;
		transition: all 0.2s ease;
		text-decoration: none;
		color: inherit;
		position: relative;
	}

	.video-card:hover {
		transform: scale(1.02);
	}

	.video-card:hover .play-overlay {
		opacity: 1;
	}

	.video-card:hover .thumb-gif {
		opacity: 1;
	}

	.video-card:hover .menu-trigger {
		opacity: 1;
	}

	.video-card:hover .thumb-gradient {
		opacity: 1;
	}

	.video-card:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.3);
		outline-offset: 2px;
	}

	/* List view card */
	.video-card.list-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 16px;
		padding: 8px;
		border-radius: 10px;
	}

	.video-card.list-card:hover {
		transform: none;
		background: rgba(255, 255, 255, 0.04);
	}

	.video-card.list-card .thumbnail {
		width: 180px;
		min-width: 180px;
		border-radius: 8px;
	}

	.video-card.list-card .card-info {
		flex: 1;
		padding: 0;
	}

	/* Thumbnail */
	.thumbnail {
		aspect-ratio: 16/9;
		background: rgba(255, 255, 255, 0.03);
		position: relative;
		overflow: hidden;
		border-radius: 12px;
	}

	.thumb-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.thumb-gif {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.thumb-gradient {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
	}

	.placeholder-thumb {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		background: rgba(255, 255, 255, 0.02);
	}

	.processing-indicator {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var(--text-tertiary);
	}

	.spinner {
		width: 28px;
		height: 28px;
		border: 2px solid rgba(255, 255, 255, 0.08);
		border-top-color: var(--text-secondary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Duration Badge */
	.duration {
		position: absolute;
		bottom: 8px;
		right: 8px;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(4px);
		padding: 3px 8px;
		border-radius: 6px;
		font-size: 11px;
		font-family: var(--font-mono);
		font-weight: 500;
		color: rgba(255, 255, 255, 0.9);
		letter-spacing: 0.03em;
		z-index: 2;
	}

	/* Play Button Overlay */
	.play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.2s ease;
		z-index: 1;
		pointer-events: none;
	}

	.play-btn {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #111;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
		padding-left: 3px;
	}

	/* Three-dot Menu */
	.menu-trigger {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(8px);
		border: none;
		border-radius: 8px;
		color: rgba(255, 255, 255, 0.9);
		cursor: pointer;
		opacity: 0;
		transition: all 0.15s ease;
		z-index: 3;
	}

	.menu-trigger:hover {
		background: rgba(0, 0, 0, 0.7);
		color: white;
	}

	/* Card Dropdown Menu */
	.card-menu {
		position: absolute;
		top: 44px;
		right: 8px;
		min-width: 180px;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		overflow: hidden;
		z-index: 50;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3);
		animation: menu-enter 0.12s ease-out;
		padding: 4px;
	}

	@keyframes menu-enter {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 12px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
		transition: all 0.1s ease;
		border-radius: 6px;
	}

	.menu-item:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}

	.menu-item.danger {
		color: #ef4444;
	}

	.menu-item.danger:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #f87171;
	}

	.menu-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
		margin: 4px 0;
	}

	/* Card Info */
	.card-info {
		padding: 12px 4px 4px;
	}

	.card-title {
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 4px;
		color: var(--text-primary);
		line-height: 1.4;
	}

	.card-date {
		font-size: 12px;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.rename-input {
		width: 100%;
		padding: 6px 10px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 500;
		outline: none;
		margin-bottom: 4px;
		transition: border-color 0.15s ease;
	}

	.rename-input:focus {
		border-color: rgba(255, 255, 255, 0.35);
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.04);
	}

	/* ============================
	   Empty State
	   ============================ */
	.empty-state {
		text-align: center;
		padding: 100px 0 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.empty-icon {
		color: var(--text-muted);
		margin-bottom: 24px;
	}

	.empty-title {
		font-size: 20px;
		font-weight: 600;
		margin-bottom: 8px;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}

	.empty-subtitle {
		color: var(--text-tertiary);
		font-size: 14px;
		margin-bottom: 32px;
		line-height: 1.5;
	}

	.cta-btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 12px 28px;
		background: var(--recording-red);
		border-radius: 999px;
		color: white;
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s ease;
		box-shadow: 0 2px 12px rgba(255, 51, 51, 0.3);
	}

	.cta-btn:hover {
		background: var(--recording-red-hover);
		box-shadow: 0 4px 20px rgba(255, 51, 51, 0.4);
		transform: translateY(-1px);
	}

	.cta-btn:active {
		transform: translateY(0);
	}

	.cta-dot {
		width: 8px;
		height: 8px;
		background: white;
		border-radius: 50%;
	}

	/* ============================
	   Skeleton Loading Cards
	   ============================ */
	.skeleton-card {
		border-radius: 12px;
		overflow: hidden;
	}

	.skeleton-thumb {
		aspect-ratio: 16/9;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 12px;
		overflow: hidden;
		position: relative;
	}

	.skeleton-info {
		padding: 12px 4px 4px;
	}

	.skeleton-title {
		height: 16px;
		width: 70%;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 6px;
		margin-bottom: 8px;
		overflow: hidden;
		position: relative;
	}

	.skeleton-date {
		height: 12px;
		width: 40%;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
		overflow: hidden;
		position: relative;
	}

	.shimmer {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.04) 40%,
			rgba(255, 255, 255, 0.08) 50%,
			rgba(255, 255, 255, 0.04) 60%,
			transparent 100%
		);
		animation: shimmer 1.8s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	/* ============================
	   Delete Confirmation Modal
	   ============================ */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: backdrop-enter 0.15s ease-out;
	}

	@keyframes backdrop-enter {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal-dialog {
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		padding: 28px;
		min-width: 360px;
		max-width: 420px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
		animation: dialog-enter 0.2s ease-out;
	}

	@keyframes dialog-enter {
		from {
			opacity: 0;
			transform: scale(0.96) translateY(8px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.modal-header {
		margin-bottom: 8px;
	}

	.modal-title {
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.modal-description {
		font-size: 13px;
		color: var(--text-tertiary);
		margin-bottom: 24px;
		line-height: 1.5;
	}

	.modal-actions {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
	}

	.btn-cancel {
		padding: 8px 20px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-cancel:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.15);
	}

	.btn-delete {
		padding: 8px 20px;
		background: #ef4444;
		border: none;
		border-radius: 8px;
		color: white;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-delete:hover {
		background: #f87171;
	}

	.btn-delete:active {
		background: #dc2626;
	}
</style>
