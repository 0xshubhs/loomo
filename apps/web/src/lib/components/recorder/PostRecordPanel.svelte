<script lang="ts">
	import type { RecordingResult } from '$lib/types/recorder.js';
	import { copyToClipboard } from '$lib/utils/clipboard.js';
	import { getAuth } from '$lib/state/context.js';
	import { createVideo, completeVideo } from '$lib/api/videos.js';
	import { uploadToPresignedUrl } from '$lib/api/upload.js';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

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
	let mounted = $state(false);

	// Upload state
	type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
	let uploadState = $state<UploadState>('idle');
	let uploadProgress = $state(0);
	let uploadError = $state<string | null>(null);
	let shareUrl = $state<string | null>(null);
	let title = $state('Untitled Recording');

	onMount(() => { mounted = true; });

	async function handleUpload() {
		if (!auth.isAuthenticated) return;

		uploadState = 'uploading';
		uploadProgress = 0;
		uploadError = null;

		try {
			const { video, upload_url } = await createVideo(title, 'browser');
			await uploadToPresignedUrl(upload_url, result.blob, (pct) => {
				uploadProgress = pct;
			});
			uploadState = 'processing';
			await completeVideo(video.id);
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

<div class="post-record" class:mounted>
	<div class="bg-gradient"></div>

	<div class="content">
		<!-- Video Preview -->
		<div class="preview-card">
			<div class="preview-container">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={videoUrl} controls class="preview-video"></video>
			</div>
		</div>

		<!-- Stats row -->
		<div class="stats-row">
			<div class="stat">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"/>
					<polyline points="12 6 12 12 16 14"/>
				</svg>
				<span>{formatDuration(result.duration)}</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
				</svg>
				<span>{formatSize(result.blob.size)}</span>
			</div>
		</div>

		{#if uploadState === 'idle'}
			<!-- Title input -->
			{#if auth.isAuthenticated}
				<div class="title-field">
					<input
						type="text"
						bind:value={title}
						class="title-input"
						placeholder="Give your recording a name..."
					/>
				</div>
			{/if}

			<!-- Action buttons -->
			<div class="actions">
				{#if auth.isAuthenticated}
					<button class="action-btn primary" onclick={handleUpload}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
							<polyline points="16 6 12 2 8 6"/>
							<line x1="12" y1="2" x2="12" y2="15"/>
						</svg>
						Upload & Share
					</button>
				{:else}
					<a href="/login" class="action-btn primary login-link">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
							<polyline points="10 17 15 12 10 7"/>
							<line x1="15" y1="12" x2="3" y2="12"/>
						</svg>
						Login to Upload
					</a>
				{/if}
				<button class="action-btn secondary" onclick={ondownload}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
						<polyline points="7 10 12 15 17 10"/>
						<line x1="12" y1="15" x2="12" y2="3"/>
					</svg>
					Download
				</button>
				<button class="action-btn ghost" onclick={onrerecord}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M1 4v6h6"/>
						<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
					</svg>
					Re-record
				</button>
			</div>

		{:else if uploadState === 'uploading'}
			<div class="upload-status">
				<div class="progress-track">
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
				<div class="success-badge">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12"/>
					</svg>
				</div>
				<p class="done-heading">Your video is ready!</p>

				<div class="share-url-row">
					<input
						type="text"
						value={shareUrl}
						readonly
						class="share-url-input"
						onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
					/>
					<button class="copy-btn" onclick={handleCopyLink}>
						{#if copied}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="20 6 9 17 4 12"/>
							</svg>
							Copied
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
							</svg>
							Copy Link
						{/if}
					</button>
				</div>

				<div class="done-actions">
					<button class="action-btn primary" onclick={handleGoToShare}>
						View Video
					</button>
					<button class="action-btn secondary" onclick={ondownload}>
						Download
					</button>
				</div>
			</div>

		{:else if uploadState === 'error'}
			<div class="upload-error">
				<div class="error-badge">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"/>
						<line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</div>
				<p class="error-text">{uploadError}</p>
				<div class="done-actions">
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
</div>

<style>
	.post-record {
		width: 100%;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		opacity: 0;
		transform: translateY(10px);
		transition: opacity 0.5s ease, transform 0.5s ease;
	}

	.post-record.mounted {
		opacity: 1;
		transform: translateY(0);
	}

	.bg-gradient {
		position: fixed;
		inset: 0;
		background:
			radial-gradient(ellipse 70% 50% at 50% -10%, rgba(255, 51, 51, 0.08), transparent),
			radial-gradient(ellipse 50% 40% at 80% 60%, rgba(100, 50, 200, 0.04), transparent);
		pointer-events: none;
	}

	.content {
		position: relative;
		z-index: 1;
		width: 640px;
		max-width: 90vw;
		padding: 48px 0;
	}

	/* Video preview */
	.preview-card {
		border-radius: 16px;
		overflow: hidden;
		background: #000;
		box-shadow: 0 16px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06);
		margin-bottom: 20px;
	}

	.preview-container {
		aspect-ratio: 16 / 9;
		position: relative;
	}

	.preview-video {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: contain;
	}

	/* Stats */
	.stats-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		margin-bottom: 24px;
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--text-tertiary);
	}

	.stat-divider {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--text-muted);
	}

	/* Title input */
	.title-field {
		margin-bottom: 20px;
	}

	.title-input {
		width: 100%;
		padding: 14px 18px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		color: var(--text-primary);
		font-size: 15px;
		font-weight: 500;
		outline: none;
		transition: all 0.2s ease;
		box-sizing: border-box;
	}

	.title-input::placeholder {
		color: var(--text-muted);
	}

	.title-input:focus {
		border-color: rgba(255, 51, 51, 0.4);
		background: rgba(255, 255, 255, 0.06);
		box-shadow: 0 0 0 3px rgba(255, 51, 51, 0.08);
	}

	/* Actions */
	.actions {
		display: flex;
		gap: 10px;
		justify-content: center;
	}

	.action-btn {
		padding: 12px 24px;
		border-radius: 12px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		border: none;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.action-btn.primary {
		background: linear-gradient(135deg, #ff3333, #ff4444);
		color: white;
		box-shadow: 0 2px 12px rgba(255, 51, 51, 0.25);
	}

	.action-btn.primary:hover {
		box-shadow: 0 4px 20px rgba(255, 51, 51, 0.35);
		transform: translateY(-1px);
	}

	.action-btn.secondary {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.action-btn.secondary:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.18);
	}

	.action-btn.ghost {
		background: transparent;
		color: var(--text-secondary);
	}

	.action-btn.ghost:hover {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.04);
	}

	.login-link {
		text-decoration: none;
	}

	/* Upload status */
	.upload-status {
		text-align: center;
		padding: 28px 0;
	}

	.status-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin-top: 14px;
	}

	.progress-track {
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #ff3333, #ff6644);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid rgba(255, 255, 255, 0.08);
		border-top-color: #ff3333;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Upload done */
	.upload-done {
		text-align: center;
	}

	.success-badge {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: linear-gradient(135deg, #22c55e, #16a34a);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 14px;
		box-shadow: 0 4px 16px rgba(34, 197, 94, 0.3);
	}

	.done-heading {
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 20px;
	}

	.share-url-row {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 16px;
	}

	.share-url-input {
		flex: 1;
		padding: 10px 14px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		color: var(--text-primary);
		font-size: 13px;
		outline: none;
		font-family: var(--font-mono);
	}

	.share-url-input:focus {
		border-color: rgba(255, 255, 255, 0.2);
	}

	.copy-btn {
		padding: 10px 16px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: all 0.2s ease;
		white-space: nowrap;
	}

	.copy-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.done-actions {
		display: flex;
		gap: 10px;
		justify-content: center;
	}

	/* Upload error */
	.upload-error {
		text-align: center;
		padding: 8px 0;
	}

	.error-badge {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: linear-gradient(135deg, #ff4444, #cc2222);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 14px;
		box-shadow: 0 4px 16px rgba(255, 68, 68, 0.3);
	}

	.error-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin-bottom: 20px;
	}
</style>
