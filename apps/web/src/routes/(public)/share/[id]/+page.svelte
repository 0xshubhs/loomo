<script lang="ts">
	import type { PageData } from './$types';
	import ShareLayout from '$lib/components/share/ShareLayout.svelte';
	import HlsPlayer from '$lib/components/share/HlsPlayer.svelte';
	import VideoInfo from '$lib/components/share/VideoInfo.svelte';
	import ReactionBar from '$lib/components/share/ReactionBar.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let { data } = $props<{ data: PageData }>();

	let currentTime = $state(0);

	// Reactive video data that can be updated by polling
	let video = $state(data.video ? { ...data.video } : null);
	let reactions = $state(data.reactions ?? []);
	let comments = $state(data.comments ?? []);

	let hlsUrl = $derived(video?.hls_url ?? '');
	let sourceUrl = $derived(video?.source_url ?? '');
	let videoId = $derived($page.params.id ?? '');

	function handleSeek(time: number) {
		currentTime = time;
	}

	// Poll for status updates when video is still processing
	onMount(() => {
		if (!video || video.status === 'ready') return;

		const id = $page.params.id;
		let pollInterval: ReturnType<typeof setInterval> | null = null;

		async function pollStatus() {
			try {
				const res = await fetch(`/api/share/${id}`);
				if (!res.ok) return;
				const raw = await res.json();

				const updated = {
					...raw,
					author_name: raw.creator?.name ?? raw.author_name ?? null,
					author_avatar: raw.creator?.avatar_url ?? raw.author_avatar ?? null,
				};

				video = updated;
				if (raw.reactions) reactions = raw.reactions;
				if (raw.comments) comments = raw.comments;

				// Stop polling once the video is ready (or failed)
				if (updated.status === 'ready' || updated.status === 'failed') {
					if (pollInterval) {
						clearInterval(pollInterval);
						pollInterval = null;
					}
				}
			} catch {
				// Silently ignore poll errors
			}
		}

		pollInterval = setInterval(pollStatus, 5000);

		return () => {
			if (pollInterval) clearInterval(pollInterval);
		};
	});
</script>

<svelte:head>
	{#if video}
		<title>{video.title} | DITTOO</title>
		<meta property="og:title" content={video.title} />
		<meta property="og:type" content="video.other" />
		{#if video.thumbnail_url}
			<meta property="og:image" content={video.thumbnail_url} />
		{/if}
	{:else}
		<title>Video Not Found | DITTOO</title>
	{/if}
</svelte:head>

<div class="share-page">
	{#if video}
		<ShareLayout
			transcriptSegments={video.transcript_segments ?? []}
			{currentTime}
			onseek={handleSeek}
			{videoId}
			{comments}
		>
			{#snippet playerSnippet()}
				<HlsPlayer
					src={hlsUrl}
					fallbackSrc={sourceUrl}
					poster={video.thumbnail_url ?? undefined}
				/>
			{/snippet}
			{#snippet videoInfoSnippet()}
				<VideoInfo
					title={video.title}
					authorName={video.author_name ?? 'Unknown'}
					authorAvatar={video.author_avatar ?? null}
					createdAt={video.created_at ?? new Date().toISOString()}
					viewCount={video.view_count ?? 0}
					{videoId}
				/>
			{/snippet}
			{#snippet reactionsSnippet()}
				<ReactionBar {videoId} {reactions} />
			{/snippet}
		</ShareLayout>
	{:else}
		<div class="not-found">
			<div class="not-found-inner">
				<div class="not-found-icon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"/>
						<line x1="12" y1="8" x2="12" y2="12"/>
						<line x1="12" y1="16" x2="12.01" y2="16"/>
					</svg>
				</div>
				<h1>Video not found</h1>
				<p>This video may have been deleted or the link is invalid.</p>
				<a href="/" class="back-link">Go home</a>
			</div>
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
		align-items: center;
		justify-content: center;
		min-height: 100vh;
	}
	.not-found-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
	}
	.not-found-icon {
		color: var(--text-muted, rgba(255, 255, 255, 0.25));
		margin-bottom: 8px;
		opacity: 0.6;
	}
	.not-found h1 {
		font-size: 24px;
		font-weight: 600;
	}
	.not-found p {
		color: var(--text-secondary);
		font-size: 14px;
	}
	.back-link {
		margin-top: 8px;
		padding: 8px 24px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		color: var(--text-primary);
		text-decoration: none;
		font-size: 13px;
		font-weight: 500;
		transition: all 0.15s ease;
	}
	.back-link:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.15);
	}
</style>
