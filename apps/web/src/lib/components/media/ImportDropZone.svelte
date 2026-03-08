<script lang="ts">
	import { isMediaFile } from '$lib/utils/file.js';

	interface Props {
		onfiles?: (files: File[]) => void;
	}

	let { onfiles }: Props = $props();

	let dragOver = $state(false);
	let fileInput: HTMLInputElement;

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (!e.dataTransfer) return;

		const files = Array.from(e.dataTransfer.files).filter(isMediaFile);
		if (files.length > 0) onfiles?.(files);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleClick() {
		fileInput.click();
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = Array.from(target.files ?? []).filter(isMediaFile);
		if (files.length > 0) onfiles?.(files);
		target.value = '';
	}
</script>

<div
	class="dropzone"
	class:dragOver
	ondrop={handleDrop}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	onclick={handleClick}
	role="button"
	tabindex="0"
>
	<div class="dropzone-content">
		<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
			<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
		</svg>
		<span class="dropzone-text">Drop media files here</span>
		<span class="dropzone-hint">or click to browse</span>
	</div>
</div>

<input
	bind:this={fileInput}
	type="file"
	accept="video/*,audio/*,image/*,.mkv,.avi,.mov,.flv,.wmv,.m4v,.3gp,.ts,.mts,.flac,.wma,.opus"
	multiple
	onchange={handleFileSelect}
	style="display:none"
/>

<style>
	.dropzone {
		border: 1px dashed var(--border-primary);
		border-radius: var(--radius-md);
		padding: 24px 16px;
		text-align: center;
		cursor: pointer;
		transition: all var(--transition-normal);
		margin: 8px;
	}

	.dropzone:hover, .dragOver {
		border-color: var(--text-tertiary);
		background: var(--bg-surface);
	}

	.dropzone-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		color: var(--text-muted);
	}

	.dropzone-text {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.dropzone-hint {
		font-size: 10px;
	}
</style>
