<script lang="ts">
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();
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
		<h1>{data.video.title}</h1>
		<p>Share page — video player coming soon</p>
	{:else}
		<h1>Video not found</h1>
	{/if}
</div>

<style>
	.share-page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: #0a0a0a;
		color: white;
	}
</style>
