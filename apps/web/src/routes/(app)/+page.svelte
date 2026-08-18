<script lang="ts">
	import { onMount } from 'svelte';
	import { getDashboard } from '$lib/state/context.js';
	import { listVideos, deleteVideo, updateVideo } from '$lib/api/videos.js';
	import { isDesktop } from '$lib/desktop/env.js';
	import { localProjects } from '$lib/desktop/projects.js';
	import DashboardLayout from '$lib/components/dashboard/DashboardLayout.svelte';
	import type { VideoItem } from '$lib/types/dashboard.js';

	const dashboard = getDashboard();

	onMount(async () => {
		await loadVideos();
	});

	/**
	 * The desktop build has no backend to talk to, so the library it shows is
	 * the offline project store. Calling the cloud API there fails on every
	 * launch and produces nothing useful.
	 */
	async function loadLocalProjects() {
		const projects = await localProjects.list();
		const videos: VideoItem[] = projects.map((p) => ({
			id: p.id,
			title: p.name || 'Untitled',
			description: null,
			status: 'ready',
			durationMs: p.duration > 0 ? Math.round(p.duration * 1000) : null,
			thumbnailUrl: p.thumbnail,
			gifUrl: null,
			hlsUrl: null,
			shareMode: 'local',
			shareUrl: `/edit?project=${p.id}`,
			createdAt: new Date(p.createdAt).toISOString(),
			updatedAt: new Date(p.updatedAt).toISOString(),
		}));
		dashboard.setVideos(videos, {
			page: 1,
			perPage: videos.length || 1,
			total: videos.length,
			hasMore: false,
		});
	}

	/**
	 * There is no rename command — a project is stored as its document, so a
	 * rename is a save that reuses the document and metadata already on disk.
	 */
	async function renameLocalProject(id: string, title: string) {
		const existing = dashboard.videos.find((v) => v.id === id);
		const document = await localProjects.load(id);
		await localProjects.save(id, title, document, {
			duration: existing?.durationMs ? existing.durationMs / 1000 : 0,
			thumbnail: existing?.thumbnailUrl ?? null,
		});
	}

	async function loadVideos() {
		dashboard.loading = true;
		try {
			if (isDesktop()) {
				await loadLocalProjects();
				return;
			}
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
			if (isDesktop()) await localProjects.remove(id);
			else await deleteVideo(id);
			dashboard.removeVideo(id);
		} catch (err) {
			console.error('Failed to delete:', err);
		}
	}}
	onrename={async (id, title) => {
		try {
			if (isDesktop()) await renameLocalProject(id, title);
			else await updateVideo(id, { title });
			dashboard.updateVideo(id, { title });
		} catch (err) {
			console.error('Failed to rename:', err);
		}
	}}
/>
