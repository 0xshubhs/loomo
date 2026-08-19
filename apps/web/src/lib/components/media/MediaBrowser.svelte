<script lang="ts">
	import { getMediaLibrary } from '$lib/state/context.js';
	import ImportDropZone from './ImportDropZone.svelte';
	import MediaCard from './MediaCard.svelte';
	import ShapeBrowser from './ShapeBrowser.svelte';
	import TitleBrowser from './TitleBrowser.svelte';
	import StockBrowser from './StockBrowser.svelte';
	import AudioBrowser from './AudioBrowser.svelte';
	import GiphyBrowser from './GiphyBrowser.svelte';
	import BackgroundBrowser from './BackgroundBrowser.svelte';

	const mediaLibrary = getMediaLibrary();

	type BrowserTab = 'media' | 'shapes' | 'titles' | 'stock' | 'audio' | 'giphy' | 'backgrounds';
	let activeTab = $state<BrowserTab>('media');

	interface Props {
		onimport?: (files: File[]) => void;
		/** Opens the OS file chooser, on platforms that have one. */
		onbrowse?: () => void;
	}

	let { onimport, onbrowse }: Props = $props();

	function handleRemove(id: string) {
		mediaLibrary.removeAsset(id);
	}
</script>

<div class="media-browser">
	<div class="browser-tabs">
		<button
			class="browser-tab"
			class:active={activeTab === 'media'}
			onclick={() => (activeTab = 'media')}
		>
			Media
			<span class="tab-count">{mediaLibrary.assets.length}</span>
		</button>
		<button
			class="browser-tab"
			class:active={activeTab === 'shapes'}
			onclick={() => (activeTab = 'shapes')}
		>
			Shapes
		</button>
		<button
			class="browser-tab"
			class:active={activeTab === 'titles'}
			onclick={() => (activeTab = 'titles')}
		>
			Titles
		</button>
		<button
			class="browser-tab"
			class:active={activeTab === 'stock'}
			onclick={() => (activeTab = 'stock')}
		>
			Stock
		</button>
		<button
			class="browser-tab"
			class:active={activeTab === 'audio'}
			onclick={() => (activeTab = 'audio')}
		>
			Audio
		</button>
		<button
			class="browser-tab"
			class:active={activeTab === 'giphy'}
			onclick={() => (activeTab = 'giphy')}
		>
			GIFs
		</button>
		<button
			class="browser-tab"
			class:active={activeTab === 'backgrounds'}
			onclick={() => (activeTab = 'backgrounds')}
		>
			BGs
		</button>
	</div>

	{#if activeTab === 'media'}
		{#if mediaLibrary.importing}
			<div class="import-progress">
				<div class="progress-bar">
					<div class="progress-fill" style="width: {mediaLibrary.importProgress * 100}%"></div>
				</div>
				<span class="progress-text">Importing...</span>
			</div>
		{/if}

		<ImportDropZone onfiles={onimport} {onbrowse} />

		<div class="asset-grid">
			{#each mediaLibrary.assets as asset (asset.id)}
				<MediaCard {asset} onremove={handleRemove} />
			{/each}
		</div>
	{:else if activeTab === 'shapes'}
		<ShapeBrowser />
	{:else if activeTab === 'titles'}
		<TitleBrowser />
	{:else if activeTab === 'stock'}
		<StockBrowser {onimport} />
	{:else if activeTab === 'audio'}
		<AudioBrowser />
	{:else if activeTab === 'giphy'}
		<GiphyBrowser {onimport} />
	{:else if activeTab === 'backgrounds'}
		<BackgroundBrowser />
	{/if}
</div>

<style>
	.media-browser {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.browser-tabs {
		display: flex;
		border-bottom: 1px solid var(--border-primary);
	}

	.browser-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 12px;
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

	.browser-tab:hover {
		color: var(--text-secondary);
	}

	.browser-tab.active {
		color: var(--text-secondary);
		border-bottom-color: var(--accent);
	}

	.tab-count {
		font-size: 10px;
		color: var(--text-muted);
		background: var(--bg-surface);
		padding: 1px 6px;
		border-radius: 8px;
		font-weight: 400;
	}

	.import-progress {
		padding: 8px 12px;
	}

	.progress-bar {
		height: 3px;
		background: var(--bg-surface);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--text-primary);
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 10px;
		color: var(--text-muted);
		margin-top: 4px;
		display: block;
	}

	.asset-grid {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
		align-content: start;
	}
</style>
