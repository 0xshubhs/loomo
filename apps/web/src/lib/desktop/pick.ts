import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './env.js';

/**
 * Choosing files without letting the webview touch them.
 *
 * WebKitGTK's `<input type="file">` hands the page a `File` whose name has
 * been percent-decoded. When the real filename contains a literal `%20` —
 * which is what a browser download of a URL-encoded name produces, so it is
 * common rather than exotic — there is nothing on disk by the decoded name,
 * and the element returns a `File` of zero bytes with no error anywhere. The
 * import then wrote an empty scratch copy and ffmpeg reported "moov atom not
 * found", which points at the source file being corrupt when it is fine.
 *
 * The native dialog returns real paths. Rust copies from the path, so no
 * filename is ever re-encoded and no bytes cross the IPC boundary.
 */

/** Extensions offered in the dialog. Everything the pipeline can decode. */
export const VIDEO_EXTENSIONS = [
	'mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp',
];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'avif'];

export interface PickedFile {
	/** Absolute path on disk, exactly as the OS reports it. */
	path: string;
	/** Display name, taken from the path rather than from the webview. */
	name: string;
}

/**
 * Opens the OS file chooser.
 *
 * Returns an empty array when the user cancels, which is not an error.
 */
export async function pickMediaFiles(): Promise<PickedFile[]> {
	if (!isDesktop()) throw new Error('The native picker needs the desktop app.');

	const selection = await open({
		multiple: true,
		title: 'Import media',
		filters: [
			{
				name: 'Media',
				extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS],
			},
			{ name: 'Video', extensions: VIDEO_EXTENSIONS },
			{ name: 'Audio', extensions: AUDIO_EXTENSIONS },
			{ name: 'Images', extensions: IMAGE_EXTENSIONS },
			{ name: 'All files', extensions: ['*'] },
		],
	});

	if (selection === null) return [];

	const paths = Array.isArray(selection) ? selection : [selection];
	return paths.map((path) => ({ path, name: basename(path) }));
}

/**
 * Copies a picked file into the scratch directory.
 *
 * Returns its size, so a source that turns out to be empty is refused here
 * rather than several minutes later inside a decode error.
 */
export async function stagePickedFile(source: string, scratchName: string): Promise<number> {
	return await invoke<number>('scratch_import', { source, name: scratchName });
}

/** The last path segment, handling both separators. */
export function basename(filePath: string): string {
	const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
	return cut === -1 ? filePath : filePath.slice(cut + 1);
}

/** Lowercased extension including the dot, or an empty string. */
export function extname(filePath: string): string {
	const name = basename(filePath);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * The extension to give a scratch copy, reduced to something safe.
 *
 * ffmpeg picks its muxer and demuxer from this, so it has to survive; but the
 * user's filename is not a safe source of one. Real names carry spaces,
 * quotes, percent escapes and the occasional newline, and a scratch name is
 * built by string concatenation and then handed to a process. Reduced to
 * letters and digits it stays both meaningful and inert.
 */
export function scratchExtension(filePath: string): string {
	const raw = extname(filePath).replace('.', '').replace(/[^a-z0-9]/g, '');
	// Cap it: an "extension" of two hundred characters is not one, and the
	// filesystem has opinions about total name length.
	const trimmed = raw.slice(0, 8);
	return trimmed ? `.${trimmed}` : '.bin';
}

/** What kind of media a path names, from its extension alone. */
export function typeFromPath(filePath: string): 'video' | 'audio' | 'image' | 'unknown' {
	const extension = extname(filePath).replace('.', '');
	if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
	if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
	if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
	return 'unknown';
}
