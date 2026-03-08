<script lang="ts">
	import type { MediaAsset } from '$lib/types/index.js';
	import { formatDuration } from '$lib/utils/time.js';
	import { formatFileSize } from '$lib/utils/file.js';

	interface Props {
		asset: MediaAsset;
		onremove?: (id: string) => void;
	}

	let { asset, onremove }: Props = $props();

	function handleDragStart(e: DragEvent) {
		e.dataTransfer?.setData('application/x-media-asset', asset.id);
		e.dataTransfer!.effectAllowed = 'copy';
	}

	function handleRemove(e: MouseEvent) {
		e.stopPropagation();
		onremove?.(asset.id);
	}
</script>

<div
	class="media-card"
	draggable="true"
	ondragstart={handleDragStart}
	role="button"
	tabindex="0"
>
	<div class="thumbnail">
		{#if asset.thumbnails.length > 0}
			<img src={asset.thumbnails[0]} alt={asset.name} />
		{:else if asset.type === 'audio'}
			<div class="placeholder audio">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
				</svg>
			</div>
		{:else}
			<div class="placeholder">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
					<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
				</svg>
			</div>
		{/if}
		<span class="duration">{formatDuration(asset.metadata.duration)}</span>
		<button class="remove-btn" onclick={handleRemove}>&times;</button>
	</div>
	<div class="info">
		<span class="name" title={asset.name}>{asset.name}</span>
		<span class="meta">
			{#if asset.metadata.width > 0}
				{asset.metadata.width}x{asset.metadata.height}
			{/if}
			{formatFileSize(asset.metadata.fileSize || asset.file.size)}
		</span>
	</div>
</div>

<style>
	.media-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
		cursor: grab;
		transition: border-color var(--transition-fast);
	}

	.media-card:hover {
		border-color: var(--border-secondary);
	}

	.media-card:active {
		cursor: grabbing;
	}

	.thumbnail {
		position: relative;
		width: 100%;
		aspect-ratio: 16/9;
		background: var(--bg-tertiary);
		overflow: hidden;
	}

	.thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.placeholder.audio {
		background: var(--bg-elevated);
	}

	.duration {
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

	.remove-btn {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 18px;
		height: 18px;
		background: rgba(0, 0, 0, 0.7);
		color: var(--text-tertiary);
		border-radius: 50%;
		font-size: 14px;
		display: none;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.media-card:hover .remove-btn {
		display: flex;
	}

	.remove-btn:hover {
		color: var(--danger);
	}

	.info {
		padding: 6px 8px;
	}

	.name {
		display: block;
		font-size: 11px;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		display: block;
		font-size: 9px;
		color: var(--text-muted);
		margin-top: 2px;
	}
</style>
