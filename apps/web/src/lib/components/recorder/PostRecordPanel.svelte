<script lang="ts">
	import type { RecordingResult } from '$lib/types/recorder.js';
	import { copyToClipboard } from '$lib/utils/clipboard.js';

	let {
		result,
		onrerecord,
		ondownload,
	}: {
		result: RecordingResult;
		onrerecord: () => void;
		ondownload: () => void;
	} = $props();

	let videoUrl = $derived(URL.createObjectURL(result.blob));
	let copied = $state(false);

	async function handleCopyLink() {
		// Placeholder — in future, this copies the share URL after upload
		await copyToClipboard(window.location.href);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div class="post-record">
	<div class="preview-container">
		<video src={videoUrl} controls class="preview-video"></video>
	</div>

	<div class="info">
		<div class="stats">
			<span>{formatDuration(result.duration)}</span>
			<span class="dot">·</span>
			<span>{formatSize(result.blob.size)}</span>
		</div>
	</div>

	<div class="actions">
		<button class="action-btn primary" onclick={ondownload}>
			Download
		</button>
		<button class="action-btn secondary" onclick={handleCopyLink}>
			{copied ? 'Copied!' : 'Copy Link'}
		</button>
		<button class="action-btn ghost" onclick={onrerecord}>
			Re-record
		</button>
	</div>
</div>

<style>
	.post-record {
		width: 640px;
		max-width: 90vw;
	}
	.preview-container {
		border-radius: 12px;
		overflow: hidden;
		background: black;
		margin-bottom: 20px;
	}
	.preview-video {
		width: 100%;
		display: block;
	}
	.info { margin-bottom: 20px; text-align: center; }
	.stats {
		font-size: 13px;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}
	.dot { opacity: 0.3; }
	.actions {
		display: flex;
		gap: 10px;
		justify-content: center;
	}
	.action-btn {
		padding: 10px 24px;
		border-radius: var(--radius-md);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: var(--transition-fast);
		border: none;
	}
	.action-btn.primary {
		background: white;
		color: black;
	}
	.action-btn.primary:hover { opacity: 0.9; }
	.action-btn.secondary {
		background: var(--bg-surface);
		color: var(--text-primary);
		border: 1px solid var(--border-primary);
	}
	.action-btn.secondary:hover { background: var(--bg-hover); }
	.action-btn.ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	.action-btn.ghost:hover { color: var(--text-primary); }
</style>
