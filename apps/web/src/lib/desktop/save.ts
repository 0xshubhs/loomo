import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './env.js';

const EXTENSION_LABELS: Record<string, string> = {
	mp4: 'MP4 video',
	mov: 'QuickTime video',
	webm: 'WebM video',
	mkv: 'Matroska video',
	avi: 'AVI video',
	gif: 'Animated GIF',
	m4a: 'M4A audio'
};

function extensionOf(filename: string): string {
	return filename.split('.').pop()?.toLowerCase() ?? 'mp4';
}

/**
 * Saves a finished render to a location the user picks.
 *
 * On the desktop this is a real Save dialog followed by a file copy that never
 * routes the bytes back through JavaScript. On the web it falls back to the
 * usual anchor-click download.
 *
 * `scratchName` is the file's name inside the ffmpeg scratch directory; when
 * the bytes only exist as a Blob (the browser recorder's output), pass `blob`
 * instead and it is written out directly.
 */
export async function saveOutput(options: {
	suggestedName: string;
	scratchName?: string;
	blob?: Blob;
}): Promise<{ saved: boolean; path?: string }> {
	const { suggestedName, scratchName, blob } = options;

	if (!isDesktop()) {
		if (!blob) throw new Error('saveOutput needs a blob on the web');
		downloadBlob(blob, suggestedName);
		return { saved: true };
	}

	const extension = extensionOf(suggestedName);
	const destination = await saveDialog({
		defaultPath: suggestedName,
		filters: [{ name: EXTENSION_LABELS[extension] ?? 'Video', extensions: [extension] }]
	});

	// null means the user dismissed the dialog — not an error.
	if (!destination) return { saved: false };

	if (scratchName) {
		await invoke('scratch_export', { path: scratchName, destination });
	} else if (blob) {
		// Stage through scratch so the copy still happens natively. The staged
		// name is generated rather than derived from suggestedName, which may
		// contain non-ASCII the IPC header cannot carry.
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const staged = `save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.tmp`;
		await invoke('scratch_write', bytes, { headers: { 'x-loomo-path': staged } });
		await invoke('scratch_export', { path: staged, destination });
		await invoke('scratch_delete', { path: staged });
	} else {
		throw new Error('saveOutput needs either scratchName or blob');
	}

	return { saved: true, path: destination };
}

/** Opens the OS file manager with the file selected. */
export async function revealInFolder(path: string): Promise<void> {
	if (!isDesktop()) return;
	await revealItemInDir(path);
}

/** The plain-browser download path, kept here so callers have one entry point. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}
