<script lang="ts">
	import { searchGifs, trendingGifs, searchStickers, trendingStickers, downloadGif, type GiphyResult } from '$lib/api/giphy.js';

	interface Props {
		onimport?: (files: File[]) => void;
	}

	let { onimport }: Props = $props();

	let query = $state('');
	let results = $state<GiphyResult[]>([]);
	let loading = $state(false);
	let tab = $state<'gifs' | 'stickers'>('gifs');
	let downloading = $state<string | null>(null);

	async function loadTrending() {
		loading = true;
		try {
			const data = tab === 'gifs' ? await trendingGifs() : await trendingStickers();
			results = data.results;
		} catch (e) {
			console.error('GIPHY trending error:', e);
		}
		loading = false;
	}

	async function handleSearch() {
		if (!query.trim()) {
			await loadTrending();
			return;
		}
		loading = true;
		try {
			const data = tab === 'gifs'
				? await searchGifs(query)
				: await searchStickers(query);
			results = data.results;
		} catch (e) {
			console.error('GIPHY search error:', e);
		}
		loading = false;
	}

	async function handleImport(gif: GiphyResult) {
		downloading = gif.id;
		try {
			const file = await downloadGif(gif);
			onimport?.([file]);
		} catch (e) {
			console.error('Download error:', e);
		}
		downloading = null;
	}

	function switchTab(newTab: 'gifs' | 'stickers') {
		tab = newTab;
		results = [];
		query = '';
		loadTrending();
	}

	// Load trending on mount
	$effect(() => {
		loadTrending();
	});
</script>

<div class="giphy-browser">
	<div class="giphy-tabs">
		<button class="gtab" class:active={tab === 'gifs'} onclick={() => switchTab('gifs')}>GIFs</button>
		<button class="gtab" class:active={tab === 'stickers'} onclick={() => switchTab('stickers')}>Stickers</button>
	</div>

	<div class="giphy-search">
		<input
			type="text"
			placeholder="Search {tab}..."
			bind:value={query}
			onkeydown={(e) => e.key === 'Enter' && handleSearch()}
		/>
		<button class="search-btn" onclick={handleSearch}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		<div class="giphy-grid">
			{#each results as gif (gif.id)}
				<button class="gif-card" onclick={() => handleImport(gif)} disabled={downloading === gif.id}>
					<img src={gif.previewUrl} alt={gif.title} loading="lazy" />
					{#if downloading === gif.id}
						<div class="gif-downloading">...</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<div class="giphy-attribution">Powered by GIPHY</div>
</div>

<style>
	.giphy-browser {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.giphy-tabs {
		display: flex;
		border-bottom: 1px solid var(--border-primary);
	}

	.gtab {
		flex: 1;
		padding: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}

	.gtab.active {
		color: var(--text-secondary);
		border-bottom-color: var(--accent);
	}

	.giphy-search {
		display: flex;
		gap: 4px;
		padding: 8px;
	}

	.giphy-search input {
		flex: 1;
		padding: 6px 10px;
		font-size: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		color: var(--text-primary);
		outline: none;
	}

	.giphy-search input:focus {
		border-color: var(--accent);
	}

	.search-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.search-btn:hover {
		background: var(--bg-hover);
	}

	.loading {
		display: flex;
		justify-content: center;
		padding: 24px;
		color: var(--text-muted);
		font-size: 12px;
	}

	.giphy-grid {
		flex: 1;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 4px;
		padding: 0 8px 8px;
		align-content: start;
	}

	.gif-card {
		position: relative;
		background: var(--bg-surface);
		border: 1px solid transparent;
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		padding: 0;
		aspect-ratio: 1;
		transition: border-color 0.15s;
	}

	.gif-card:hover {
		border-color: var(--accent);
	}

	.gif-card img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.gif-downloading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		font-size: 12px;
	}

	.giphy-attribution {
		padding: 4px 8px;
		font-size: 9px;
		color: var(--text-muted);
		text-align: center;
		border-top: 1px solid var(--border-primary);
	}
</style>
