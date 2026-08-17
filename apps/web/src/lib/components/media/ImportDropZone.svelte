<script lang="ts">
	import { isMediaFile } from '$lib/utils/file.js';

	interface Props {
		onfiles?: (files: File[]) => void;
	}

	let { onfiles }: Props = $props();

	let dragOver = $state(false);
	let fileInput: HTMLInputElement;
	/** Shown when a pick produced nothing usable, so it never fails silently. */
	let rejected = $state<string | null>(null);

	/**
	 * Hands accepted files upward and explains anything it drops.
	 *
	 * Previously both entry points did `.filter(isMediaFile)` and then simply
	 * returned when the result was empty, so an unrecognised file — or a
	 * chooser that handed back nothing at all — looked identical to no action
	 * whatsoever. Reporting it is the difference between a bug you can see and
	 * one you have to guess at.
	 */
	function accept(incoming: File[], source: 'drop' | 'picker') {
		rejected = null;

		if (incoming.length === 0) {
			console.warn(`[import] ${source} produced no files`);
			rejected = 'No files were received.';
			return;
		}

		const usable = incoming.filter(isMediaFile);
		const skipped = incoming.filter((f) => !isMediaFile(f));

		console.info(
			`[import] ${source}: ${incoming.length} file(s), ${usable.length} usable`,
			incoming.map((f) => `${f.name} (${f.type || 'no mime'}, ${f.size}B)`)
		);

		if (skipped.length > 0) {
			rejected = `Unsupported: ${skipped.map((f) => f.name).join(', ')}`;
		}

		if (usable.length === 0) {
			console.warn('[import] every file was filtered out as non-media');
			return;
		}

		if (!onfiles) {
			console.error('[import] no onfiles handler is wired to the drop zone');
			rejected = 'Import is not wired up (no handler).';
			return;
		}

		onfiles(usable);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (!e.dataTransfer) {
			console.warn('[import] drop event carried no dataTransfer');
			return;
		}
		accept(Array.from(e.dataTransfer.files), 'drop');
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleClick() {
		console.info('[import] opening file picker');
		fileInput.click();
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		accept(Array.from(target.files ?? []), 'picker');
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
		{#if rejected}
			<span class="dropzone-rejected">{rejected}</span>
		{/if}
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

	.dropzone-rejected {
		margin-top: 6px;
		font-size: 10px;
		line-height: 1.4;
		color: #ffbf5f;
		max-width: 100%;
		word-break: break-word;
	}

	.dropzone-hint {
		font-size: 10px;
	}
</style>
