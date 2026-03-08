<script lang="ts">
	import { getMediaLibrary } from '$lib/state/context.js';
	import ImportDropZone from './ImportDropZone.svelte';
	import MediaCard from './MediaCard.svelte';

	const mediaLibrary = getMediaLibrary();

	interface Props {
		onimport?: (files: File[]) => void;
	}

	let { onimport }: Props = $props();

	function handleRemove(id: string) {
		mediaLibrary.removeAsset(id);
	}
</script>

<div class="media-browser">
	<div class="browser-header">
		<h3>Media</h3>
		<span class="count">{mediaLibrary.assets.length}</span>
	</div>

	{#if mediaLibrary.importing}
		<div class="import-progress">
			<div class="progress-bar">
				<div class="progress-fill" style="width: {mediaLibrary.importProgress * 100}%"></div>
			</div>
			<span class="progress-text">Importing...</span>
		</div>
	{/if}

	<ImportDropZone onfiles={onimport} />

	<div class="asset-grid">
		{#each mediaLibrary.assets as asset (asset.id)}
			<MediaCard {asset} onremove={handleRemove} />
		{/each}
	</div>
</div>

<style>
	.media-browser {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.browser-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border-primary);
	}

	.browser-header h3 {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.count {
		font-size: 10px;
		color: var(--text-muted);
		background: var(--bg-surface);
		padding: 1px 6px;
		border-radius: 8px;
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
