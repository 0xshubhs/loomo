<script lang="ts">
	import type { Snippet } from 'svelte';
	import TranscriptPanel from './TranscriptPanel.svelte';
	import CommentsPanel from './CommentsPanel.svelte';

	interface TranscriptSegment {
		start: number;
		end: number;
		text: string;
	}

	interface Comment {
		id: string;
		author_name: string;
		author_avatar?: string;
		body: string;
		timestamp_seconds?: number;
		created_at: string;
	}

	interface Props {
		playerSnippet: Snippet;
		videoInfoSnippet: Snippet;
		reactionsSnippet?: Snippet;
		transcriptSegments?: TranscriptSegment[];
		currentTime?: number;
		onseek?: (time: number) => void;
		videoId?: string;
		comments?: Comment[];
	}

	let {
		playerSnippet,
		videoInfoSnippet,
		reactionsSnippet,
		transcriptSegments = [],
		currentTime = 0,
		onseek,
		videoId = '',
		comments = [],
	}: Props = $props();

	let activeTab = $state<'transcript' | 'comments'>('comments');
	let commentCount = $derived(comments.length);
</script>

<div class="share-layout">
	<div class="main-column">
		<div class="player-wrap">
			{@render playerSnippet()}
		</div>
		<div class="video-info-wrap">
			{@render videoInfoSnippet()}
		</div>
		{#if reactionsSnippet}
			<div class="reactions-wrap">
				{@render reactionsSnippet()}
			</div>
		{/if}
	</div>

	<aside class="sidebar">
		<div class="tabs">
			<button
				class="tab"
				class:active={activeTab === 'transcript'}
				onclick={() => activeTab = 'transcript'}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px; opacity: 0.7;">
					<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
				</svg>
				Transcript
			</button>
			<button
				class="tab"
				class:active={activeTab === 'comments'}
				onclick={() => activeTab = 'comments'}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px; opacity: 0.7;">
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
				</svg>
				Comments
				{#if commentCount > 0}
					<span class="tab-badge">{commentCount}</span>
				{/if}
			</button>
		</div>

		<div class="tab-content">
			{#if activeTab === 'transcript'}
				<TranscriptPanel segments={transcriptSegments} {currentTime} {onseek} />
			{:else}
				<CommentsPanel {videoId} {comments} {onseek} />
			{/if}
		</div>
	</aside>
</div>

<style>
	.share-layout {
		display: flex;
		gap: 24px;
		max-width: 1440px;
		margin: 0 auto;
		padding: 32px 24px;
		min-height: 100vh;
		color: var(--text-primary);
	}

	.main-column {
		flex: 0 0 65%;
		min-width: 0;
	}

	.player-wrap {
		margin-bottom: 0;
	}

	.video-info-wrap {
		/* Spacing handled by VideoInfo component */
	}

	.reactions-wrap {
		padding: 0;
		border-bottom: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
		padding-bottom: 16px;
	}

	.sidebar {
		flex: 1;
		min-width: 0;
		background: rgba(255, 255, 255, 0.03);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 16px;
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 64px);
		position: sticky;
		top: 32px;
		overflow: hidden;
	}

	.tabs {
		display: flex;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
		padding: 4px 4px 0;
		gap: 2px;
	}

	.tab {
		flex: 1;
		padding: 10px 16px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px 8px 0 0;
		position: relative;
	}

	.tab:hover {
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.04);
	}

	.tab.active {
		color: var(--text-primary);
		border-bottom-color: #6366f1;
		background: rgba(99, 102, 241, 0.06);
	}

	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		margin-left: 6px;
		background: rgba(99, 102, 241, 0.2);
		color: #a5b4fc;
		font-size: 10px;
		font-weight: 600;
		border-radius: 9px;
		line-height: 1;
	}

	.tab-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}

	@media (max-width: 900px) {
		.share-layout {
			flex-direction: column;
			padding: 16px;
		}
		.main-column {
			flex: none;
			width: 100%;
		}
		.sidebar {
			position: static;
			max-height: 500px;
		}
	}
</style>
