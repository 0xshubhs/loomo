<script lang="ts">
	import { onMount } from 'svelte';
	import CommentItem from './CommentItem.svelte';

	interface Comment {
		id: string;
		author_name: string;
		author_avatar?: string;
		body: string;
		timestamp_seconds?: number;
		created_at: string;
	}

	interface Props {
		videoId: string;
		comments: Comment[];
		onseek?: (time: number) => void;
	}

	let { videoId, comments: initialComments, onseek }: Props = $props();

	let comments = $state<Comment[]>([]);
	let authorName = $state('');
	let commentBody = $state('');
	let submitting = $state(false);
	let scrollContainer: HTMLDivElement | undefined = $state();

	onMount(() => {
		comments = [...initialComments];
		// Load saved author name from localStorage
		const saved = localStorage.getItem('dittoo_comment_name');
		if (saved) authorName = saved;
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!commentBody.trim() || submitting) return;

		const name = authorName.trim() || 'Anonymous';
		const body = commentBody.trim();
		submitting = true;

		// Optimistic add
		const tempId = `temp-${Date.now()}`;
		const optimistic: Comment = {
			id: tempId,
			author_name: name,
			body,
			created_at: new Date().toISOString(),
		};
		comments = [...comments, optimistic];
		commentBody = '';

		// Save name to localStorage
		if (authorName.trim()) {
			localStorage.setItem('dittoo_comment_name', authorName.trim());
		}

		// Scroll to bottom
		requestAnimationFrame(() => {
			if (scrollContainer) {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			}
		});

		try {
			const res = await fetch(`/api/share/${videoId}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body, author_name: name }),
			});
			if (res.ok) {
				const data = await res.json();
				// Replace temp with real comment
				comments = comments.map(c => c.id === tempId ? { ...data } : c);
			}
		} catch {
			// Remove optimistic comment on error
			comments = comments.filter(c => c.id !== tempId);
		} finally {
			submitting = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			handleSubmit(e);
		}
	}
</script>

<div class="comments-panel">
	<div class="comments-list" bind:this={scrollContainer}>
		{#if comments.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
					</svg>
				</div>
				<p class="empty-text">No comments yet</p>
				<p class="empty-hint">Be the first to leave a comment</p>
			</div>
		{:else}
			{#each comments as comment (comment.id)}
				<CommentItem {comment} {onseek} />
			{/each}
		{/if}
	</div>

	<form class="comment-form" onsubmit={handleSubmit}>
		<div class="form-row">
			<input
				type="text"
				class="name-input"
				placeholder="Your name"
				bind:value={authorName}
				maxlength="100"
			/>
		</div>
		<div class="form-row textarea-row">
			<textarea
				class="body-input"
				placeholder="Add a comment..."
				bind:value={commentBody}
				onkeydown={handleKeydown}
				rows="2"
				maxlength="2000"
			></textarea>
			<button
				type="submit"
				class="submit-btn"
				disabled={!commentBody.trim() || submitting}
				aria-label="Post comment"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
				</svg>
			</button>
		</div>
		<p class="form-hint">Press <kbd>Cmd</kbd>+<kbd>Enter</kbd> to post</p>
	</form>
</div>

<style>
	.comments-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.comments-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px 0;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 24px;
		text-align: center;
	}

	.empty-icon {
		color: var(--text-muted, rgba(255, 255, 255, 0.25));
		margin-bottom: 12px;
		opacity: 0.6;
	}

	.empty-text {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
		margin: 0 0 4px;
	}

	.empty-hint {
		font-size: 12px;
		color: var(--text-muted, rgba(255, 255, 255, 0.3));
		margin: 0;
	}

	.comment-form {
		border-top: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
		padding: 12px 16px;
		flex-shrink: 0;
	}

	.form-row {
		margin-bottom: 8px;
	}

	.name-input {
		width: 100%;
		padding: 8px 12px;
		background: var(--bg-primary, rgba(0, 0, 0, 0.3));
		border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
		color: var(--text-primary);
		font-size: 13px;
		outline: none;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
	}

	.name-input:focus {
		border-color: var(--border-secondary, rgba(255, 255, 255, 0.2));
	}

	.name-input::placeholder {
		color: var(--text-muted, rgba(255, 255, 255, 0.3));
	}

	.textarea-row {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		margin-bottom: 4px;
	}

	.body-input {
		flex: 1;
		padding: 8px 12px;
		background: var(--bg-primary, rgba(0, 0, 0, 0.3));
		border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
		color: var(--text-primary);
		font-size: 13px;
		font-family: inherit;
		outline: none;
		resize: none;
		transition: border-color 0.15s ease;
		min-height: 40px;
	}

	.body-input:focus {
		border-color: var(--border-secondary, rgba(255, 255, 255, 0.2));
	}

	.body-input::placeholder {
		color: var(--text-muted, rgba(255, 255, 255, 0.3));
	}

	.submit-btn {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #6366f1;
		border: none;
		border-radius: 8px;
		color: white;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.submit-btn:hover:not(:disabled) {
		background: #4f46e5;
		transform: scale(1.05);
	}

	.submit-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.form-hint {
		font-size: 11px;
		color: var(--text-muted, rgba(255, 255, 255, 0.25));
		margin: 0;
	}

	.form-hint kbd {
		padding: 1px 4px;
		background: var(--bg-surface, rgba(255, 255, 255, 0.06));
		border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.1));
		border-radius: 3px;
		font-size: 10px;
		font-family: inherit;
	}
</style>
