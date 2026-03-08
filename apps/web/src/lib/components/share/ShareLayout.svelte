<script lang="ts">
	import type { Snippet } from 'svelte';

	interface TranscriptSegment {
		start: number;
		end: number;
		text: string;
	}

	interface Props {
		playerSnippet: Snippet;
		videoInfoSnippet: Snippet;
		transcriptSegments?: TranscriptSegment[];
		currentTime?: number;
		onseek?: (time: number) => void;
	}

	let { playerSnippet, videoInfoSnippet, transcriptSegments = [], currentTime = 0, onseek }: Props = $props();

	import TranscriptPanel from './TranscriptPanel.svelte';

	let activeTab = $state<'transcript' | 'comments'>('transcript');
</script>

<div class="share-layout">
	<div class="main-column">
		<div class="player-wrap">
			{@render playerSnippet()}
		</div>
		<div class="video-info-wrap">
			{@render videoInfoSnippet()}
		</div>
	</div>

	<aside class="sidebar">
		<div class="tabs">
			<button
				class="tab"
				class:active={activeTab === 'transcript'}
				onclick={() => activeTab = 'transcript'}
			>
				Transcript
			</button>
			<button
				class="tab"
				class:active={activeTab === 'comments'}
				onclick={() => activeTab = 'comments'}
			>
				Comments
			</button>
		</div>

		<div class="tab-content">
			{#if activeTab === 'transcript'}
				<TranscriptPanel segments={transcriptSegments} {currentTime} {onseek} />
			{:else}
				<div class="comments-placeholder">
					<p>Comments coming soon</p>
				</div>
			{/if}
		</div>
	</aside>
</div>

<style>
	.share-layout {
		display: flex;
		gap: 24px;
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px;
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
	.sidebar {
		flex: 1;
		min-width: 0;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 48px);
		position: sticky;
		top: 24px;
	}
	.tabs {
		display: flex;
		border-bottom: 1px solid var(--border-primary);
		flex-shrink: 0;
	}
	.tab {
		flex: 1;
		padding: 12px 16px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: var(--transition-fast);
	}
	.tab:hover {
		color: var(--text-primary);
		background: var(--bg-hover);
	}
	.tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--text-primary);
	}
	.tab-content {
		flex: 1;
		overflow-y: auto;
	}
	.comments-placeholder {
		padding: 40px 20px;
		text-align: center;
		color: var(--text-muted);
		font-size: 13px;
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
			max-height: 400px;
		}
	}
</style>
