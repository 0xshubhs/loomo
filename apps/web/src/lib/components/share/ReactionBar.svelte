<script lang="ts">
	interface ReactionCount {
		emoji: string;
		count: number;
	}

	interface Props {
		videoId: string;
		reactions: ReactionCount[];
	}

	let { videoId, reactions: initialReactions }: Props = $props();

	const EMOJIS = [
		{ emoji: '\u{1F44D}', label: 'Thumbs Up' },
		{ emoji: '\u{2764}\u{FE0F}', label: 'Heart' },
		{ emoji: '\u{1F525}', label: 'Fire' },
		{ emoji: '\u{1F602}', label: 'Laugh' },
		{ emoji: '\u{1F44F}', label: 'Clap' },
		{ emoji: '\u{1F389}', label: 'Party' },
	];

	let reactionCounts = $state<Map<string, number>>(new Map());
	let animatingEmoji = $state<string | null>(null);
	let floatingEmojis = $state<{ id: number; emoji: string; x: number }[]>([]);
	let nextFloatId = 0;

	$effect(() => {
		const map = new Map<string, number>();
		for (const r of initialReactions) {
			map.set(r.emoji, r.count);
		}
		reactionCounts = map;
	});

	function getCount(emoji: string): number {
		return reactionCounts.get(emoji) ?? 0;
	}

	async function handleReaction(emoji: string, event: MouseEvent) {
		// Optimistic update
		const current = getCount(emoji);
		reactionCounts.set(emoji, current + 1);
		reactionCounts = new Map(reactionCounts);

		// Animate
		animatingEmoji = emoji;
		setTimeout(() => { animatingEmoji = null; }, 300);

		// Floating emoji effect
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const id = nextFloatId++;
		floatingEmojis = [...floatingEmojis, { id, emoji, x: rect.left + rect.width / 2 }];
		setTimeout(() => {
			floatingEmojis = floatingEmojis.filter(f => f.id !== id);
		}, 1000);

		// API call
		try {
			await fetch(`/api/share/${videoId}/reactions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emoji }),
			});
		} catch {
			// Revert on error
			reactionCounts.set(emoji, current);
			reactionCounts = new Map(reactionCounts);
		}
	}
</script>

<div class="reaction-bar">
	{#each EMOJIS as { emoji, label }}
		{@const count = getCount(emoji)}
		<button
			class="reaction-btn"
			class:has-count={count > 0}
			class:animating={animatingEmoji === emoji}
			onclick={(e) => handleReaction(emoji, e)}
			aria-label="{label} ({count})"
			title={label}
		>
			<span class="reaction-emoji">{emoji}</span>
			{#if count > 0}
				<span class="reaction-count">{count}</span>
			{/if}
		</button>
	{/each}
</div>

{#each floatingEmojis as float (float.id)}
	<span class="floating-emoji" style="left: {float.x}px;">
		{float.emoji}
	</span>
{/each}

<style>
	.reaction-bar {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		padding: 12px 0;
	}

	.reaction-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--bg-surface, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.08));
		border-radius: 999px;
		cursor: pointer;
		transition: all 0.2s ease;
		color: var(--text-primary);
		font-size: 14px;
		line-height: 1;
		user-select: none;
	}

	.reaction-btn:hover {
		background: var(--bg-hover, rgba(255, 255, 255, 0.1));
		border-color: var(--border-secondary, rgba(255, 255, 255, 0.15));
		transform: translateY(-1px);
	}

	.reaction-btn:active {
		transform: scale(0.95);
	}

	.reaction-btn.has-count {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.12);
	}

	.reaction-btn.animating {
		animation: reaction-pop 0.3s ease;
	}

	.reaction-emoji {
		font-size: 18px;
		line-height: 1;
		display: flex;
		align-items: center;
	}

	.reaction-count {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
		font-variant-numeric: tabular-nums;
		min-width: 12px;
		text-align: center;
	}

	.floating-emoji {
		position: fixed;
		font-size: 24px;
		pointer-events: none;
		z-index: 9999;
		animation: float-up 1s ease-out forwards;
		transform: translateX(-50%);
	}

	@keyframes reaction-pop {
		0% { transform: scale(1); }
		50% { transform: scale(1.2); }
		100% { transform: scale(1); }
	}

	@keyframes float-up {
		0% {
			opacity: 1;
			bottom: 20%;
			transform: translateX(-50%) scale(1);
		}
		100% {
			opacity: 0;
			bottom: 60%;
			transform: translateX(-50%) scale(1.5);
		}
	}
</style>
