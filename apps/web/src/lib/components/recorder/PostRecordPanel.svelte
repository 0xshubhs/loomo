<script lang="ts">
	import type { RecordingResult } from '$lib/types/recorder.js';
	import { copyToClipboard } from '$lib/utils/clipboard.js';
	import { getAuth } from '$lib/state/context.js';
	import { createVideo, completeVideo } from '$lib/api/videos.js';
	import { uploadToPresignedUrl } from '$lib/api/upload.js';
	import { goto } from '$app/navigation';

	let {
		result,
		onrerecord,
		ondownload,
	}: {
		result: RecordingResult;
		onrerecord: () => void;
		ondownload: () => void;
	} = $props();

	const auth = getAuth();

	let videoUrl = $derived(URL.createObjectURL(result.blob));
	let copied = $state(false);

	// Upload state
	type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
	let uploadState = $state<UploadState>('idle');
	let uploadProgress = $state(0);
	let uploadError = $state<string | null>(null);
	let shareUrl = $state<string | null>(null);
	let title = $state('Untitled Recording');

	async function handleUpload() {
		if (!auth.isAuthenticated) return;

		uploadState = 'uploading';
		uploadProgress = 0;
		uploadError = null;

		try {
			// Step 1: Create video record and get presigned URL
			const { video, upload_url } = await createVideo(title, 'browser');

			// Step 2: Upload blob to presigned URL
			await uploadToPresignedUrl(upload_url, result.blob, (pct) => {
				uploadProgress = pct;
			});

			// Step 3: Tell backend upload is complete
			uploadState = 'processing';
			await completeVideo(video.id);

			// Step 4: Build share URL and set done
			const url = `${window.location.origin}/share/${video.share_id}`;
			shareUrl = url;
			uploadState = 'done';
		} catch (err) {
			console.error('Upload failed:', err);
			uploadError = err instanceof Error ? err.message : 'Upload failed';
			uploadState = 'error';
		}
	}

	async function handleCopyLink() {
		if (!shareUrl) return;
		await copyToClipboard(shareUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function handleGoToShare() {
		if (shareUrl) goto(shareUrl);
	}

	function handleRetryUpload() {
		uploadState = 'idle';
		uploadError = null;
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

	{#if uploadState === 'idle'}
		<!-- Title input and action buttons -->
		{#if auth.isAuthenticated}
			<div class="title-field">
				<label for="video-title" class="title-label">Title</label>
				<input
					id="video-title"
					type="text"
					bind:value={title}
					class="title-input"
					placeholder="Enter a title..."
				/>
			</div>
		{/if}

		<div class="actions">
			{#if auth.isAuthenticated}
				<button class="action-btn primary" onclick={handleUpload}>
					Upload & Share
				</button>
			{:else}
				<a href="/login" class="action-btn primary login-link">
					Login to Upload
				</a>
			{/if}
			<button class="action-btn secondary" onclick={ondownload}>
				Download
			</button>
			<button class="action-btn ghost" onclick={onrerecord}>
				Re-record
			</button>
		</div>

	{:else if uploadState === 'uploading'}
		<div class="upload-status">
			<div class="progress-bar">
				<div class="progress-fill" style="width: {uploadProgress}%"></div>
			</div>
			<p class="status-text">Uploading... {uploadProgress}%</p>
		</div>

	{:else if uploadState === 'processing'}
		<div class="upload-status">
			<div class="spinner"></div>
			<p class="status-text">Processing video...</p>
		</div>

	{:else if uploadState === 'done' && shareUrl}
		<div class="upload-done">
			<div class="success-icon">&#10003;</div>
			<p class="done-text">Your video is ready!</p>
			<div class="share-url-row">
				<input
					type="text"
					value={shareUrl}
					readonly
					class="share-url-input"
					onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
				<button class="action-btn secondary" onclick={handleCopyLink}>
					{copied ? 'Copied!' : 'Copy Link'}
				</button>
			</div>
			<div class="actions" style="margin-top: 12px;">
				<button class="action-btn primary" onclick={handleGoToShare}>
					View Video
				</button>
				<button class="action-btn secondary" onclick={ondownload}>
					Download
				</button>
			</div>
		</div>

	{:else if uploadState === 'error'}
		<div class="upload-status error">
			<p class="error-text">{uploadError}</p>
			<div class="actions">
				<button class="action-btn primary" onclick={handleRetryUpload}>
					Try Again
				</button>
				<button class="action-btn secondary" onclick={ondownload}>
					Download Instead
				</button>
			</div>
		</div>
	{/if}
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
	.info {
		margin-bottom: 20px;
		text-align: center;
	}
	.stats {
		font-size: 13px;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}
	.dot {
		opacity: 0.3;
	}
	.title-field {
		margin-bottom: 16px;
	}
	.title-label {
		display: block;
		font-size: 12px;
		color: var(--text-secondary);
		margin-bottom: 6px;
	}
	.title-input {
		width: 100%;
		padding: 10px 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 14px;
		outline: none;
		transition: border-color var(--transition-fast);
		box-sizing: border-box;
	}
	.title-input:focus {
		border-color: var(--text-secondary);
	}
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
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.action-btn.primary {
		background: white;
		color: black;
	}
	.action-btn.primary:hover {
		opacity: 0.9;
	}
	.action-btn.secondary {
		background: var(--bg-surface);
		color: var(--text-primary);
		border: 1px solid var(--border-primary);
	}
	.action-btn.secondary:hover {
		background: var(--bg-hover);
	}
	.action-btn.ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	.action-btn.ghost:hover {
		color: var(--text-primary);
	}
	.login-link {
		text-decoration: none;
	}
	.upload-status {
		text-align: center;
		padding: 24px 0;
	}
	.status-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin-top: 12px;
	}
	.progress-bar {
		width: 100%;
		height: 6px;
		background: var(--bg-surface);
		border-radius: 3px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: white;
		border-radius: 3px;
		transition: width 0.2s ease;
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border-primary);
		border-top-color: var(--text-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.upload-done {
		text-align: center;
	}
	.success-icon {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: #22c55e;
		color: white;
		font-size: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 12px;
	}
	.done-text {
		font-size: 16px;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 16px;
	}
	.share-url-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.share-url-input {
		flex: 1;
		padding: 8px 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 13px;
		outline: none;
	}
	.share-url-input:focus {
		border-color: var(--text-secondary);
	}
	.upload-status.error {
		color: var(--danger);
	}
	.error-text {
		font-size: 14px;
		color: var(--danger);
		margin-bottom: 16px;
	}
</style>
