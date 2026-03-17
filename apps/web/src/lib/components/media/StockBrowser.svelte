<script lang="ts">
	import {
		searchPhotos,
		searchVideos,
		getCuratedPhotos,
		getPopularVideos,
		downloadStockFile,
		pickBestVideoFile,
		getApiKey,
		setApiKey,
		type StockPhoto,
		type StockVideo,
		StockMediaApiError,
	} from '$lib/api/stock-media.js';

	interface Props {
		onimport?: (files: File[]) => void;
	}

	let { onimport }: Props = $props();

	type StockTab = 'photos' | 'videos';
	let activeTab = $state<StockTab>('photos');
	let query = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// API key state
	let apiKey = $state(getApiKey());
	let apiKeyInput = $state(getApiKey());
	let apiKeyError = $state('');

	// Data state
	let photos = $state<StockPhoto[]>([]);
	let videos = $state<StockVideo[]>([]);
	let totalPhotos = $state(0);
	let totalVideos = $state(0);
	let photoPage = $state(1);
	let videoPage = $state(1);
	let loading = $state(false);
	let error = $state('');

	// Download state
	let downloadingId = $state<number | null>(null);
	let downloadProgress = $state(0);

	function handleSaveApiKey() {
		const trimmed = apiKeyInput.trim();
		if (!trimmed) {
			apiKeyError = 'Please enter an API key';
			return;
		}
		setApiKey(trimmed);
		apiKey = trimmed;
		apiKeyError = '';
		// Load initial content
		loadContent(true);
	}

	function handleRemoveApiKey() {
		setApiKey('');
		apiKey = '';
		apiKeyInput = '';
		photos = [];
		videos = [];
	}

	function handleSearchInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			loadContent(true);
		}, 300);
	}

	function handleTabSwitch(tab: StockTab) {
		activeTab = tab;
		if (tab === 'photos' && photos.length === 0) {
			loadContent(true);
		} else if (tab === 'videos' && videos.length === 0) {
			loadContent(true);
		}
	}

	async function loadContent(reset = false) {
		if (!apiKey) return;
		loading = true;
		error = '';

		if (reset) {
			if (activeTab === 'photos') {
				photos = [];
				photoPage = 1;
			} else {
				videos = [];
				videoPage = 1;
			}
		}

		try {
			if (activeTab === 'photos') {
				if (query.trim()) {
					const result = await searchPhotos(query.trim(), photoPage);
					if (reset) {
						photos = result.photos;
					} else {
						photos = [...photos, ...result.photos];
					}
					totalPhotos = result.total_results;
				} else {
					const result = await getCuratedPhotos(photoPage);
					if (reset) {
						photos = result.photos;
					} else {
						photos = [...photos, ...result.photos];
					}
					totalPhotos = Infinity; // curated doesn't give total
				}
			} else {
				if (query.trim()) {
					const result = await searchVideos(query.trim(), videoPage);
					if (reset) {
						videos = result.videos;
					} else {
						videos = [...videos, ...result.videos];
					}
					totalVideos = result.total_results;
				} else {
					const result = await getPopularVideos(videoPage);
					if (reset) {
						videos = result.videos;
					} else {
						videos = [...videos, ...result.videos];
					}
					totalVideos = Infinity;
				}
			}
		} catch (err) {
			if (err instanceof StockMediaApiError) {
				if (err.status === 401) {
					apiKeyError = 'Invalid API key. Please check and try again.';
					error = '';
				} else {
					error = err.message;
				}
			} else {
				error = `Failed to load content: ${err}`;
			}
		} finally {
			loading = false;
		}
	}

	function loadMore() {
		if (activeTab === 'photos') {
			photoPage++;
		} else {
			videoPage++;
		}
		loadContent(false);
	}

	let hasMorePhotos = $derived(photos.length < totalPhotos);
	let hasMoreVideos = $derived(videos.length < totalVideos);

	async function handleAddPhoto(photo: StockPhoto) {
		if (downloadingId !== null) return;
		downloadingId = photo.id;
		downloadProgress = 0;

		try {
			const ext = 'jpg';
			const filename = `pexels-${photo.id}.${ext}`;
			const file = await downloadStockFile(
				photo.src.large,
				filename,
				(p) => { downloadProgress = p; }
			);
			onimport?.([file]);
		} catch (err) {
			error = `Download failed: ${err}`;
			setTimeout(() => { error = ''; }, 5000);
		} finally {
			downloadingId = null;
			downloadProgress = 0;
		}
	}

	async function handleAddVideo(video: StockVideo) {
		if (downloadingId !== null) return;
		downloadingId = video.id;
		downloadProgress = 0;

		try {
			const bestFile = pickBestVideoFile(video.video_files);
			if (!bestFile) {
				error = 'No suitable video file found';
				return;
			}
			const ext = 'mp4';
			const filename = `pexels-${video.id}.${ext}`;
			const file = await downloadStockFile(
				bestFile.link,
				filename,
				(p) => { downloadProgress = p; }
			);
			onimport?.([file]);
		} catch (err) {
			error = `Download failed: ${err}`;
			setTimeout(() => { error = ''; }, 5000);
		} finally {
			downloadingId = null;
			downloadProgress = 0;
		}
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// Load initial content if API key is present
	$effect(() => {
		if (apiKey) {
			loadContent(true);
		}
	});
</script>

<div class="stock-browser">
	{#if !apiKey}
		<div class="api-key-setup">
			<div class="setup-icon">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
				</svg>
			</div>
			<h3 class="setup-title">Pexels API Key Required</h3>
			<p class="setup-desc">
				Get free stock photos and videos from Pexels.
				<a href="https://www.pexels.com/api/new/" target="_blank" rel="noopener noreferrer">
					Get a free API key
				</a>
			</p>
			<div class="api-key-form">
				<input
					type="text"
					class="api-key-input"
					placeholder="Paste your API key here..."
					bind:value={apiKeyInput}
					onkeydown={(e) => e.key === 'Enter' && handleSaveApiKey()}
				/>
				<button class="save-key-btn" onclick={handleSaveApiKey}>Save</button>
			</div>
			{#if apiKeyError}
				<p class="api-key-error">{apiKeyError}</p>
			{/if}
		</div>
	{:else}
		<div class="stock-tabs">
			<button
				class="stock-tab"
				class:active={activeTab === 'photos'}
				onclick={() => handleTabSwitch('photos')}
			>
				Photos
			</button>
			<button
				class="stock-tab"
				class:active={activeTab === 'videos'}
				onclick={() => handleTabSwitch('videos')}
			>
				Videos
			</button>
			<button
				class="key-settings-btn"
				onclick={handleRemoveApiKey}
				title="Remove API key"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
				</svg>
			</button>
		</div>

		<div class="search-bar">
			<input
				type="text"
				class="search-input"
				placeholder="Search {activeTab}..."
				bind:value={query}
				oninput={handleSearchInput}
			/>
		</div>

		{#if apiKeyError}
			<div class="error-msg">{apiKeyError}</div>
		{/if}

		{#if error}
			<div class="error-msg">{error}</div>
		{/if}

		{#if downloadingId !== null}
			<div class="download-progress">
				<div class="progress-bar">
					<div class="progress-fill" style="width: {downloadProgress * 100}%"></div>
				</div>
				<span class="progress-text">Downloading... {Math.round(downloadProgress * 100)}%</span>
			</div>
		{/if}

		<div class="results-grid">
			{#if activeTab === 'photos'}
				{#each photos as photo (photo.id)}
					<div class="stock-card" class:downloading={downloadingId === photo.id}>
						<div class="stock-thumbnail" style="aspect-ratio: {photo.width}/{photo.height}">
							<img src={photo.src.medium} alt={photo.alt || 'Stock photo'} loading="lazy" />
							<div class="stock-overlay">
								<button
									class="add-btn"
									onclick={() => handleAddPhoto(photo)}
									disabled={downloadingId !== null}
								>
									{downloadingId === photo.id ? 'Downloading...' : 'Add to Project'}
								</button>
							</div>
						</div>
						<div class="stock-info">
							<span class="photographer" title={photo.photographer}>
								{photo.photographer}
							</span>
							<span class="dimensions">{photo.width}x{photo.height}</span>
						</div>
					</div>
				{/each}
			{:else}
				{#each videos as video (video.id)}
					<div class="stock-card" class:downloading={downloadingId === video.id}>
						<div class="stock-thumbnail">
							<img src={video.image} alt="Stock video" loading="lazy" />
							<span class="video-duration">{formatDuration(video.duration)}</span>
							<div class="stock-overlay">
								<button
									class="add-btn"
									onclick={() => handleAddVideo(video)}
									disabled={downloadingId !== null}
								>
									{downloadingId === video.id ? 'Downloading...' : 'Add to Project'}
								</button>
							</div>
						</div>
						<div class="stock-info">
							<span class="photographer" title={video.user.name}>
								{video.user.name}
							</span>
							<span class="dimensions">{video.width}x{video.height}</span>
						</div>
					</div>
				{/each}
			{/if}

			{#if loading}
				<div class="loading-skeletons">
					{#each Array(6) as _}
						<div class="skeleton-card">
							<div class="skeleton-thumb"></div>
							<div class="skeleton-info">
								<div class="skeleton-line"></div>
								<div class="skeleton-line short"></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if !loading && ((activeTab === 'photos' && photos.length > 0 && hasMorePhotos) || (activeTab === 'videos' && videos.length > 0 && hasMoreVideos))}
			<button class="load-more-btn" onclick={loadMore}>
				Load More
			</button>
		{/if}

		{#if !loading && ((activeTab === 'photos' && photos.length === 0) || (activeTab === 'videos' && videos.length === 0))}
			<div class="empty-state">
				<p>No {activeTab} found</p>
				{#if query.trim()}
					<p class="empty-hint">Try a different search term</p>
				{/if}
			</div>
		{/if}

		<div class="pexels-attribution">
			<a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">
				Powered by Pexels
			</a>
		</div>
	{/if}
</div>

<style>
	.stock-browser {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* API Key Setup */
	.api-key-setup {
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
	}

	.setup-icon {
		color: var(--text-muted);
	}

	.setup-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		margin: 0;
	}

	.setup-desc {
		font-size: 11px;
		color: var(--text-muted);
		margin: 0;
		line-height: 1.5;
	}

	.setup-desc a {
		color: var(--accent);
		text-decoration: none;
	}

	.setup-desc a:hover {
		text-decoration: underline;
	}

	.api-key-form {
		display: flex;
		gap: 6px;
		width: 100%;
	}

	.api-key-input {
		flex: 1;
		padding: 6px 8px;
		font-size: 11px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		outline: none;
	}

	.api-key-input:focus {
		border-color: var(--accent);
	}

	.save-key-btn {
		padding: 6px 12px;
		font-size: 11px;
		font-weight: 600;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.save-key-btn:hover {
		opacity: 0.9;
	}

	.api-key-error {
		font-size: 10px;
		color: var(--danger, #e55);
		margin: 0;
	}

	/* Tabs */
	.stock-tabs {
		display: flex;
		border-bottom: 1px solid var(--border-primary);
		align-items: center;
	}

	.stock-tab {
		flex: 1;
		padding: 6px 12px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.stock-tab:hover {
		color: var(--text-secondary);
	}

	.stock-tab.active {
		color: var(--text-secondary);
		border-bottom-color: var(--accent);
	}

	.key-settings-btn {
		padding: 4px 8px;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
	}

	.key-settings-btn:hover {
		color: var(--text-secondary);
	}

	/* Search */
	.search-bar {
		padding: 8px;
	}

	.search-input {
		width: 100%;
		padding: 6px 8px;
		font-size: 11px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		outline: none;
		box-sizing: border-box;
	}

	.search-input:focus {
		border-color: var(--accent);
	}

	/* Error */
	.error-msg {
		padding: 6px 8px;
		margin: 0 8px;
		font-size: 10px;
		color: var(--danger, #e55);
		background: rgba(255, 80, 80, 0.1);
		border-radius: var(--radius-sm);
	}

	/* Download Progress */
	.download-progress {
		padding: 6px 8px;
		margin: 0 8px;
	}

	.progress-bar {
		height: 3px;
		background: var(--bg-surface);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s ease;
	}

	.progress-text {
		font-size: 10px;
		color: var(--text-muted);
		margin-top: 4px;
		display: block;
	}

	/* Results Grid */
	.results-grid {
		flex: 1;
		overflow-y: auto;
		padding: 4px 8px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		align-content: start;
	}

	/* Stock Card */
	.stock-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.stock-card:hover {
		border-color: var(--border-secondary);
	}

	.stock-card.downloading {
		opacity: 0.6;
		pointer-events: none;
	}

	.stock-thumbnail {
		position: relative;
		width: 100%;
		aspect-ratio: 4/3;
		background: var(--bg-tertiary);
		overflow: hidden;
	}

	.stock-thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.stock-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.stock-card:hover .stock-overlay {
		opacity: 1;
	}

	.add-btn {
		padding: 6px 10px;
		font-size: 10px;
		font-weight: 600;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		white-space: nowrap;
	}

	.add-btn:hover {
		opacity: 0.9;
	}

	.add-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.video-duration {
		position: absolute;
		bottom: 4px;
		right: 4px;
		background: rgba(0, 0, 0, 0.8);
		padding: 1px 4px;
		border-radius: 2px;
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text-secondary);
	}

	.stock-info {
		padding: 4px 6px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 4px;
	}

	.photographer {
		font-size: 10px;
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.dimensions {
		font-size: 9px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	/* Loading Skeletons */
	.loading-skeletons {
		display: contents;
	}

	.skeleton-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.skeleton-thumb {
		width: 100%;
		aspect-ratio: 4/3;
		background: var(--bg-tertiary);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.skeleton-info {
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.skeleton-line {
		height: 8px;
		background: var(--bg-tertiary);
		border-radius: 4px;
		animation: pulse 1.5s ease-in-out infinite;
	}

	.skeleton-line.short {
		width: 60%;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 0.8; }
	}

	/* Load More */
	.load-more-btn {
		margin: 8px;
		padding: 8px;
		font-size: 11px;
		font-weight: 600;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.15s;
	}

	.load-more-btn:hover {
		background: var(--bg-tertiary);
	}

	/* Empty State */
	.empty-state {
		padding: 24px 16px;
		text-align: center;
		color: var(--text-muted);
		font-size: 12px;
		grid-column: 1 / -1;
	}

	.empty-state p {
		margin: 0;
	}

	.empty-hint {
		font-size: 10px;
		margin-top: 4px;
	}

	/* Attribution */
	.pexels-attribution {
		padding: 6px 8px;
		text-align: center;
		border-top: 1px solid var(--border-primary);
		flex-shrink: 0;
	}

	.pexels-attribution a {
		font-size: 10px;
		color: var(--text-muted);
		text-decoration: none;
	}

	.pexels-attribution a:hover {
		color: var(--text-secondary);
		text-decoration: underline;
	}
</style>
