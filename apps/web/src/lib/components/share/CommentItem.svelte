<script lang="ts">
	import { relativeTime } from '$lib/utils/time.js';

	interface Comment {
		id: string;
		author_name: string;
		author_avatar?: string;
		body: string;
		timestamp_seconds?: number;
		created_at: string;
	}

	interface Props {
		comment: Comment;
		onseek?: (time: number) => void;
	}

	let { comment, onseek }: Props = $props();

	let timeAgo = $derived(relativeTime(comment.created_at));

	function getInitial(name: string): string {
		return name.charAt(0).toUpperCase();
	}

	// Deterministic color from name
	function getAvatarColor(name: string): string {
		const colors = [
			'#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
			'#ec4899', '#f43f5e', '#ef4444', '#f97316',
			'#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
			'#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
		];
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return colors[Math.abs(hash) % colors.length];
	}

	function formatTimestamp(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleTimestampClick() {
		if (comment.timestamp_seconds != null && onseek) {
			onseek(comment.timestamp_seconds);
		}
	}
</script>

<div class="comment-item">
	<div class="comment-avatar" style="background-color: {getAvatarColor(comment.author_name)}">
		{#if comment.author_avatar}
			<img src={comment.author_avatar} alt={comment.author_name} class="avatar-img" />
		{:else}
			<span class="avatar-initial">{getInitial(comment.author_name)}</span>
		{/if}
	</div>

	<div class="comment-content">
		<div class="comment-header">
			<span class="comment-author">{comment.author_name}</span>
			<span class="comment-time">{timeAgo}</span>
		</div>

		{#if comment.timestamp_seconds != null}
			<button class="timestamp-link" onclick={handleTimestampClick}>
				{formatTimestamp(comment.timestamp_seconds)}
			</button>
		{/if}

		<p class="comment-body">{comment.body}</p>
	</div>
</div>

<style>
	.comment-item {
		display: flex;
		gap: 12px;
		padding: 12px 16px;
		transition: background 0.15s ease;
	}

	.comment-item:hover {
		background: var(--bg-hover, rgba(255, 255, 255, 0.03));
	}

	.comment-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-initial {
		font-size: 13px;
		font-weight: 600;
		color: white;
		line-height: 1;
	}

	.comment-content {
		flex: 1;
		min-width: 0;
	}

	.comment-header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 2px;
	}

	.comment-author {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.comment-time {
		font-size: 11px;
		color: var(--text-muted, rgba(255, 255, 255, 0.35));
	}

	.timestamp-link {
		display: inline-flex;
		align-items: center;
		padding: 1px 6px;
		margin-bottom: 4px;
		background: rgba(99, 102, 241, 0.15);
		border: none;
		border-radius: 4px;
		color: #818cf8;
		font-size: 11px;
		font-family: var(--font-mono, monospace);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.timestamp-link:hover {
		background: rgba(99, 102, 241, 0.25);
		color: #a5b4fc;
	}

	.comment-body {
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-secondary, rgba(255, 255, 255, 0.7));
		margin: 0;
		word-break: break-word;
		white-space: pre-wrap;
	}
</style>
