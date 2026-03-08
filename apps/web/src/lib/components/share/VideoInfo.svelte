<script lang="ts">
	import { copyToClipboard } from '$lib/utils/clipboard.js';
	import { relativeTime } from '$lib/utils/time.js';
	import Icon from '$lib/components/shared/Icon.svelte';

	interface Props {
		title: string;
		authorName: string;
		authorAvatar: string | null;
		createdAt: string;
		viewCount: number;
	}

	let { title, authorName, authorAvatar, createdAt, viewCount }: Props = $props();

	let copied = $state(false);

	async function handleShare() {
		const success = await copyToClipboard(window.location.href);
		if (success) {
			copied = true;
			setTimeout(() => copied = false, 2000);
		}
	}

	let timeAgo = $derived(relativeTime(createdAt));

	function formatViewCount(count: number): string {
		if (count < 1000) return `${count} views`;
		if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K views`;
		return `${(count / 1_000_000).toFixed(1)}M views`;
	}
</script>

<div class="video-info">
	<h1 class="video-title">{title}</h1>

	<div class="meta-row">
		<div class="author">
			<div class="avatar">
				{#if authorAvatar}
					<img src={authorAvatar} alt={authorName} class="avatar-img" />
				{:else}
					<div class="avatar-fallback">
						<Icon name="user" size={16} />
					</div>
				{/if}
			</div>
			<span class="author-name">{authorName}</span>
		</div>

		<div class="meta-right">
			<span class="meta-text">{formatViewCount(viewCount)}</span>
			<span class="meta-sep">&middot;</span>
			<span class="meta-text">{timeAgo}</span>

			<button class="share-btn" onclick={handleShare}>
				<Icon name={copied ? 'check' : 'link'} size={14} />
				{copied ? 'Copied!' : 'Share'}
			</button>
		</div>
	</div>
</div>

<style>
	.video-info {
		padding: 16px 0;
	}
	.video-title {
		font-size: 20px;
		font-weight: 600;
		line-height: 1.3;
		margin-bottom: 12px;
		color: var(--text-primary);
	}
	.meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}
	.author {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
	}
	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar-fallback {
		width: 100%;
		height: 100%;
		background: var(--bg-surface);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}
	.author-name {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-primary);
	}
	.meta-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.meta-text {
		font-size: 13px;
		color: var(--text-secondary);
	}
	.meta-sep {
		color: var(--text-muted);
	}
	.share-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: 999px;
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: var(--transition-fast);
	}
	.share-btn:hover {
		background: var(--bg-hover);
	}
</style>
