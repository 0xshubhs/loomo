<script lang="ts">
	import { onMount } from 'svelte';
	import { getDashboard } from '$lib/state/context.js';
	import { listVideos, deleteVideo, updateVideo } from '$lib/api/videos.js';
	import DashboardLayout from '$lib/components/dashboard/DashboardLayout.svelte';
	import type { VideoItem } from '$lib/types/dashboard.js';

	const dashboard = getDashboard();

	onMount(async () => {
		await loadVideos();
	});

	async function loadVideos() {
		dashboard.loading = true;
		try {
			const res = await listVideos(dashboard.pagination.page, dashboard.pagination.perPage);
			const videos: VideoItem[] = (res.videos ?? []).map((v: any) => ({
				id: v.id,
				title: v.title ?? 'Untitled',
				description: v.description ?? null,
				status: v.status ?? 'processing',
				durationMs: v.duration ?? null,
				thumbnailUrl: v.thumbnail_url ?? null,
				gifUrl: v.gif_url ?? null,
				hlsUrl: v.hls_url ?? null,
				shareMode: v.share_mode ?? 'unlisted',
				shareUrl: `/share/${v.id}`,
				createdAt: v.created_at,
				updatedAt: v.updated_at ?? v.created_at,
			}));
			dashboard.setVideos(videos, {
				page: res.pagination?.page ?? 1,
				perPage: res.pagination?.per_page ?? 20,
				total: res.pagination?.total ?? videos.length,
				hasMore: res.pagination?.has_more ?? false,
			});
		} catch (err) {
			console.error('Failed to load videos:', err);
		} finally {
			dashboard.loading = false;
		}
	}
</script>

<DashboardLayout
	ondelete={async (id) => {
		try {
			await deleteVideo(id);
			dashboard.removeVideo(id);
		} catch (err) {
			console.error('Failed to delete:', err);
		}
	}}
	onrename={async (id, title) => {
		try {
			await updateVideo(id, { title });
			dashboard.updateVideo(id, { title });
		} catch (err) {
			console.error('Failed to rename:', err);
		}
	}}
/>
