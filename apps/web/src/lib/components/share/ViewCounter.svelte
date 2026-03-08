<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		videoId: string;
		initialCount: number;
	}

	let { videoId, initialCount }: Props = $props();

	let viewCount = $state(initialCount);
	let recorded = $state(false);

	onMount(async () => {
		try {
			const res = await fetch(`/api/share/${videoId}/view`, {
				method: 'POST',
			});
			if (res.ok) {
				const data = await res.json();
				viewCount = data.view_count;
				recorded = data.recorded;
			}
		} catch {
			// Silent fail - view tracking is not critical
		}
	});

	function formatCount(count: number): string {
		if (count < 1000) return `${count}`;
		if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
</script>

<span class="view-counter" class:just-recorded={recorded}>
	<svg class="view-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
	</svg>
	<span class="view-text">{formatCount(viewCount)} views</span>
</span>

<style>
	.view-counter {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
	}

	.view-icon {
		opacity: 0.7;
	}

	.view-text {
		font-variant-numeric: tabular-nums;
	}

	.just-recorded {
		animation: view-flash 0.5s ease;
	}

	@keyframes view-flash {
		0% { opacity: 1; }
		50% { opacity: 0.5; }
		100% { opacity: 1; }
	}
</style>
