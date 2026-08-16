import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './env.js';

export interface LocalProjectMeta {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	duration: number;
	sizeBytes: number;
	thumbnail: string | null;
}

/**
 * The desktop app's offline project library.
 *
 * Projects live in the OS app-data directory rather than on the server, so the
 * editor keeps working with no network at all. Imported media is copied into
 * the project, which means a project survives the user moving or deleting the
 * file they originally dragged in.
 */
export const localProjects = {
	get available(): boolean {
		return isDesktop();
	},

	async list(): Promise<LocalProjectMeta[]> {
		if (!isDesktop()) return [];
		return await invoke<LocalProjectMeta[]>('projects_list');
	},

	/** The stored document, exactly as `save` received it. */
	async load(id: string): Promise<string> {
		return await invoke<string>('projects_load', { id });
	},

	async save(
		id: string,
		name: string,
		document: string,
		options: { duration?: number; thumbnail?: string | null } = {}
	): Promise<LocalProjectMeta> {
		return await invoke<LocalProjectMeta>('projects_save', {
			id,
			name,
			document,
			duration: options.duration ?? 0,
			thumbnail: options.thumbnail ?? null
		});
	},

	async remove(id: string): Promise<void> {
		await invoke('projects_delete', { id });
	},

	/** Copies a file already on disk into the project's media vault. */
	async importFile(id: string, source: string, filename: string): Promise<string> {
		return await invoke<string>('projects_import_media', { id, source, filename });
	},

	/** Stores bytes — a `File` the user dropped, or a finished recording. */
	async writeMedia(id: string, filename: string, data: ArrayBuffer | Uint8Array): Promise<string> {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		return await invoke<string>('projects_write_media', bytes, {
			headers: {
				'x-loomo-project': id,
				// IPC headers are ASCII-only; real filenames are not.
				'x-loomo-filename': encodeURIComponent(filename)
			}
		});
	},

	/** Folder on disk, for a "reveal in file manager" action. */
	async directory(id?: string): Promise<string> {
		return await invoke<string>('projects_dir', { id: id ?? null });
	}
};
