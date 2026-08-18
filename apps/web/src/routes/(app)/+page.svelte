<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { localProjects, type LocalProjectMeta } from '$lib/desktop/projects.js';
	import { isDesktop } from '$lib/desktop/env.js';
	import { generateId } from '$lib/utils/id.js';
	import ProjectLibrary from '$lib/components/projects/ProjectLibrary.svelte';

	/**
	 * The app's home: the project library.
	 *
	 * Projects live in the user's own app-data folder. There is no account and
	 * nothing is uploaded anywhere, so this is the whole story — what is on
	 * disk is what exists.
	 */

	let projects = $state<LocalProjectMeta[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(load);

	async function load() {
		loading = true;
		error = null;
		try {
			if (!isDesktop()) {
				error = 'Projects are stored on disk. Open the desktop app to use them.';
				projects = [];
				return;
			}
			projects = sortByEdited(await localProjects.list());
		} catch (err) {
			console.error('Could not list projects:', err);
			error = `Could not read your projects: ${err}`;
		} finally {
			loading = false;
		}
	}

	/** Most recently edited first — the one you want is almost always the last one. */
	function sortByEdited(list: LocalProjectMeta[]): LocalProjectMeta[] {
		return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	function handleNew() {
		// The id is minted here so the editor has one route and one lifecycle;
		// nothing is written to disk until the project is saved.
		goto(`/edit/${generateId()}`);
	}

	async function handleRename(id: string, name: string) {
		try {
			const document = await localProjects.load(id);
			const existing = projects.find((p) => p.id === id);
			await localProjects.save(id, name, document, {
				duration: existing?.duration ?? 0,
				thumbnail: existing?.thumbnail ?? null,
			});
			await load();
		} catch (err) {
			error = `Could not rename the project: ${err}`;
		}
	}

	async function handleDelete(id: string) {
		try {
			await localProjects.remove(id);
			projects = projects.filter((p) => p.id !== id);
		} catch (err) {
			error = `Could not delete the project: ${err}`;
		}
	}
</script>

<ProjectLibrary
	{projects}
	{loading}
	{error}
	onnew={handleNew}
	onopen={(id) => goto(`/edit/${id}`)}
	onrename={handleRename}
	ondelete={handleDelete}
/>
