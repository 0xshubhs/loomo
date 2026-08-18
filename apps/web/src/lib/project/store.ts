import { localProjects, type LocalProjectMeta } from '$lib/desktop/projects.js';
import { isDesktop } from '$lib/desktop/env.js';
import { generateId } from '$lib/utils/id.js';
import type { MediaAsset } from '$lib/types/media.js';
import {
	buildDocument,
	documentDuration,
	parseDocument,
	storedFilename,
	type EditorSnapshot,
	type ProjectDocument,
} from './document.js';

/**
 * Saving and reopening a project.
 *
 * A project owns its media: every clip is copied into the project folder when
 * it is saved, so the project still opens after the user has moved, renamed or
 * deleted the file they originally imported. That copy happens in Rust, from
 * the scratch directory the import already wrote to, so nothing large passes
 * through JavaScript in either direction.
 */

export interface SaveResult {
	id: string;
	meta: LocalProjectMeta;
}

/** Saves the editor's current state, creating the project if it is new. */
export async function saveProject(
	snapshot: EditorSnapshot,
	options: { id?: string | null; now: number }
): Promise<SaveResult> {
	if (!isDesktop()) {
		throw new Error('Projects are stored on disk and need the desktop app.');
	}

	const id = options.id ?? generateId();

	// Media first: a document that names a file which was never copied would
	// open to an empty timeline.
	const stored = new Map<string, string>();
	for (const asset of snapshot.assets) {
		const filename = await adoptMedia(id, asset);
		if (filename) stored.set(asset.id, filename);
	}

	const document = buildDocument(snapshot, stored, options.now);
	const meta = await localProjects.save(id, snapshot.name, JSON.stringify(document), {
		duration: documentDuration(document),
		thumbnail: snapshot.assets[0]?.thumbnails[0] ?? null,
	});

	return { id, meta };
}

/**
 * Copies one asset's media into the project.
 *
 * Returns the stored filename, or null when the bytes cannot be found — an
 * asset whose staging was cleared is skipped rather than failing the whole
 * save, since losing one clip is better than losing the edit.
 */
async function adoptMedia(projectId: string, asset: MediaAsset): Promise<string | null> {
	const filename = storedFilename(asset);

	try {
		if (asset.scratchName) {
			const source = await localProjects.scratchPath(asset.scratchName);
			await localProjects.importFile(projectId, source, filename);
			return filename;
		}

		// Images and audio are not staged at import, so their bytes still live
		// in the File the picker handed over.
		if (asset.file && asset.file.size > 0) {
			await localProjects.writeMedia(projectId, filename, await asset.file.arrayBuffer());
			return filename;
		}
	} catch (error) {
		console.warn(`[project] could not store media for "${asset.name}":`, error);
	}

	return null;
}

export interface OpenedProject {
	id: string;
	document: ProjectDocument;
	/** Assets rebuilt with their media staged and ready for ffmpeg. */
	assets: MediaAsset[];
}

/** Reads a project back and stages its media for playback and export. */
export async function openProject(id: string): Promise<OpenedProject> {
	if (!isDesktop()) {
		throw new Error('Projects are stored on disk and need the desktop app.');
	}

	const document = parseDocument(await localProjects.load(id));
	const assets: MediaAsset[] = [];

	for (const stored of document.assets) {
		const scratchName = `media_${stored.id}${extensionOf(stored.file)}`;
		let staged: string | undefined;
		try {
			staged = await localProjects.stageMedia(id, stored.file, scratchName);
		} catch (error) {
			console.warn(`[project] media for "${stored.name}" is missing:`, error);
		}

		assets.push({
			id: stored.id,
			name: stored.name,
			// The bytes stay on disk. Nothing on the desktop path reads this
			// File — ffmpeg works from `scratchName` — and materialising a
			// gigabyte here to satisfy the type would defeat the point.
			file: new File([], stored.name, { type: mimeFor(stored.type) }),
			blobUrl: '',
			type: stored.type,
			metadata: stored.metadata,
			thumbnails: stored.thumbnails,
			waveform: null,
			addedAt: document.savedAt,
			scratchName: staged,
		});
	}

	return { id, document, assets };
}

function extensionOf(filename: string): string {
	const index = filename.lastIndexOf('.');
	return index === -1 ? '' : filename.slice(index);
}

function mimeFor(type: 'video' | 'audio' | 'image'): string {
	if (type === 'audio') return 'audio/mp4';
	if (type === 'image') return 'image/png';
	return 'video/mp4';
}
