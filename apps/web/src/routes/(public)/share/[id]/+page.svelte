<script lang="ts">
	import type { PageData } from './$types';
	import ShareLayout from '$lib/components/share/ShareLayout.svelte';
	import HlsPlayer from '$lib/components/share/HlsPlayer.svelte';
	import VideoInfo from '$lib/components/share/VideoInfo.svelte';

	let { data } = $props<{ data: PageData }>();

	let currentTime = $state(0);

	function handleSeek(time: number) {
		currentTime = time;
		// The HlsPlayer will handle the actual seek via its own internal state
		// This is used for transcript sync
	}
</script>

<svelte:head>
	{#if data.video}
		<title>{data.video.title} | DITTOO</title>
		<meta property="og:title" content={data.video.title} />
		<meta property="og:type" content="video.other" />
		{#if data.video.thumbnail_url}
			<meta property="og:image" content={data.video.thumbnail_url} />
		{/if}
	{:else}
		<title>Video Not Found | DITTOO</title>
	{/if}
</svelte:head>

<div class="share-page">
	{#if data.video}
		<ShareLayout
			transcriptSegments={data.video.transcript_segments ?? []}
			{currentTime}
			onseek={handleSeek}
		>
			{#snippet playerSnippet()}
				<HlsPlayer
					src={data.video.hls_url ?? ''}
					poster={data.video.thumbnail_url ?? undefined}
				/>
			{/snippet}
			{#snippet videoInfoSnippet()}
				<VideoInfo
					title={data.video.title}
					authorName={data.video.author_name ?? 'Unknown'}
					authorAvatar={data.video.author_avatar ?? null}
					createdAt={data.video.created_at ?? new Date().toISOString()}
					viewCount={data.video.view_count ?? 0}
				/>
			{/snippet}
		</ShareLayout>
	{:else}
		<div class="not-found">
			<h1>Video not found</h1>
			<p>This video may have been deleted or the link is invalid.</p>
			<a href="/" class="back-link">Go home</a>
		</div>
	{/if}
</div>

<style>
	.share-page {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-primary);
	}
	.not-found {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		text-align: center;
		gap: 12px;
	}
	.not-found h1 { font-size: 24px; }
	.not-found p { color: var(--text-secondary); }
	.back-link {
		margin-top: 12px;
		padding: 8px 20px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		text-decoration: none;
		font-size: 13px;
	}
	.back-link:hover { background: var(--bg-hover); }
</style>
