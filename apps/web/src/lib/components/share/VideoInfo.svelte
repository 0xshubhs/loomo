<script lang="ts">
	import { copyToClipboard } from '$lib/utils/clipboard.js';
	import { relativeTime } from '$lib/utils/time.js';
	import Icon from '$lib/components/shared/Icon.svelte';
	import ViewCounter from './ViewCounter.svelte';

	interface Props {
		title: string;
		authorName: string;
		authorAvatar: string | null;
		createdAt: string;
		viewCount: number;
		videoId: string;
	}

	let { title, authorName, authorAvatar, createdAt, viewCount, videoId }: Props = $props();

	let copied = $state(false);

	async function handleShare() {
		const success = await copyToClipboard(window.location.href);
		if (success) {
			copied = true;
			setTimeout(() => copied = false, 2000);
		}
	}

	let timeAgo = $derived(relativeTime(createdAt));

	function getAuthorInitial(name: string): string {
		return name.charAt(0).toUpperCase();
	}

	function getAuthorColor(name: string): string {
		const colors = [
			'#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
			'#ec4899', '#f43f5e', '#ef4444', '#f97316',
		];
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}
</script>

<div class="video-info">
	<h1 class="video-title">{title}</h1>

	<div class="meta-row">
		<div class="author">
			<div class="avatar" style="background-color: {getAuthorColor(authorName)}">
				{#if authorAvatar}
					<img src={authorAvatar} alt={authorName} class="avatar-img" />
				{:else}
					<span class="avatar-initial">{getAuthorInitial(authorName)}</span>
				{/if}
			</div>
			<div class="author-info">
				<span class="author-name">{authorName}</span>
				<span class="author-time">{timeAgo}</span>
			</div>
		</div>

		<div class="meta-right">
			<ViewCounter {videoId} initialCount={viewCount} />

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
		font-size: 22px;
		font-weight: 600;
		line-height: 1.3;
		margin-bottom: 14px;
		color: var(--text-primary);
		letter-spacing: -0.01em;
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
		width: 36px;
		height: 36px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar-initial {
		font-size: 14px;
		font-weight: 600;
		color: white;
		line-height: 1;
	}
	.author-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.author-name {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-primary);
		line-height: 1.2;
	}
	.author-time {
		font-size: 12px;
		color: var(--text-muted, rgba(255, 255, 255, 0.35));
		line-height: 1.2;
	}
	.meta-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.share-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 16px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.share-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.15);
	}
</style>
