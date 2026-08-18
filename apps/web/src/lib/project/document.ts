import type { MediaAsset, MediaMetadata } from '$lib/types/media.js';
import type { Track } from '$lib/types/timeline.js';
import type { Transition, TextOverlay, ShapeOverlay, CaptionTrack } from '$lib/types/effects.js';
import type { Annotation } from '$lib/types/annotations.js';

/**
 * What a saved project contains.
 *
 * Everything the editor holds except the media bytes themselves: those are
 * copied into the project's own folder, and each asset here names its file.
 * That is what lets a project survive the user moving or deleting whatever they
 * originally dragged in.
 *
 * `version` is checked on load. A project written by a newer build is refused
 * rather than half-read, since silently dropping tracks a format added is worse
 * than saying no.
 */
export const PROJECT_FORMAT_VERSION = 1;

/** An asset as stored: metadata plus the filename inside the project. */
export interface StoredAsset {
	id: string;
	name: string;
	type: 'video' | 'audio' | 'image';
	/** Filename within the project's `media/` folder. */
	file: string;
	metadata: MediaMetadata;
	thumbnails: string[];
}

export interface ProjectDocument {
	version: number;
	name: string;
	savedAt: number;
	assets: StoredAsset[];
	tracks: Track[];
	transitions: Transition[];
	textOverlays: TextOverlay[];
	shapeOverlays: ShapeOverlay[];
	annotations: Annotation[];
	captions: CaptionTrack | null;
	aspectRatio: string | null;
}

export interface EditorSnapshot {
	name: string;
	assets: MediaAsset[];
	tracks: Track[];
	transitions: Transition[];
	textOverlays: TextOverlay[];
	shapeOverlays: ShapeOverlay[];
	annotations: Annotation[];
	captions: CaptionTrack | null;
	aspectRatio: string | null;
}

/**
 * Turns the editor's state into something that can be written to disk.
 *
 * Assets keep the filename they were stored under, which is derived from the
 * asset id rather than the display name: two clips can both be called
 * "video.mp4", and the user's name for a file is not a safe key.
 */
export function buildDocument(
	snapshot: EditorSnapshot,
	storedFilenames: Map<string, string>,
	savedAt: number
): ProjectDocument {
	return {
		version: PROJECT_FORMAT_VERSION,
		name: snapshot.name,
		savedAt,
		assets: snapshot.assets
			.filter((asset) => storedFilenames.has(asset.id))
			.map((asset) => ({
				id: asset.id,
				name: asset.name,
				type: asset.type,
				file: storedFilenames.get(asset.id)!,
				metadata: asset.metadata,
				// Data URLs, so a reopened project shows its filmstrip without
				// having to decode every clip again.
				thumbnails: asset.thumbnails.filter((t) => t.startsWith('data:')),
			})),
		tracks: snapshot.tracks,
		transitions: snapshot.transitions,
		textOverlays: snapshot.textOverlays,
		shapeOverlays: snapshot.shapeOverlays,
		annotations: snapshot.annotations,
		captions: snapshot.captions,
		aspectRatio: snapshot.aspectRatio,
	};
}

/** The filename an asset's media is stored under inside the project. */
export function storedFilename(asset: { id: string; name: string }): string {
	const extension = asset.name.includes('.') ? asset.name.split('.').pop()! : 'bin';
	return `${asset.id}.${extension.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export class ProjectFormatError extends Error {}

/**
 * Reads a stored document back, rejecting anything it cannot faithfully load.
 *
 * Deliberately strict about the version and lenient about missing optional
 * collections: a project saved before drawings existed simply has none, which
 * is different from a project written by a build that knows something we do not.
 */
export function parseDocument(json: string): ProjectDocument {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		throw new ProjectFormatError('This project file is damaged and cannot be read.');
	}

	if (!raw || typeof raw !== 'object') {
		throw new ProjectFormatError('This project file is damaged and cannot be read.');
	}

	const doc = raw as Partial<ProjectDocument>;
	if (typeof doc.version !== 'number') {
		throw new ProjectFormatError('This file is not a Loomo project.');
	}
	if (doc.version > PROJECT_FORMAT_VERSION) {
		throw new ProjectFormatError(
			`This project was saved by a newer version of Loomo (format ${doc.version}). Update to open it.`
		);
	}

	return {
		version: doc.version,
		name: typeof doc.name === 'string' ? doc.name : 'Untitled project',
		savedAt: typeof doc.savedAt === 'number' ? doc.savedAt : 0,
		assets: Array.isArray(doc.assets) ? doc.assets : [],
		tracks: Array.isArray(doc.tracks) ? doc.tracks : [],
		transitions: Array.isArray(doc.transitions) ? doc.transitions : [],
		textOverlays: Array.isArray(doc.textOverlays) ? doc.textOverlays : [],
		shapeOverlays: Array.isArray(doc.shapeOverlays) ? doc.shapeOverlays : [],
		annotations: Array.isArray(doc.annotations) ? doc.annotations : [],
		captions: doc.captions ?? null,
		aspectRatio: doc.aspectRatio ?? null,
	};
}

/** Longest point on the timeline, used for the project's listed duration. */
export function documentDuration(doc: ProjectDocument): number {
	let end = 0;
	for (const track of doc.tracks) {
		for (const clip of track.clips) {
			end = Math.max(end, clip.timelineStart + clip.duration);
		}
	}
	return end;
}
