import { describe, it, expect, vi } from 'vitest';
import { assetBlob } from './asset-bytes.js';
import type { MediaAsset } from '$lib/types/media.js';
import type { FFmpegEngine } from './ffmpeg-engine.js';

/**
 * An asset's bytes live in one of three places, and callers kept assuming the
 * first. Captions and silence detection fetched `asset.blobUrl` — which is
 * empty for anything picked through the OS dialog or reopened from a project,
 * so they failed on exactly the files that imported most cleanly.
 */

function asset(over: Partial<MediaAsset> = {}): MediaAsset {
	return {
		id: 'a1',
		name: 'clip.mp4',
		file: new File([], 'clip.mp4'),
		blobUrl: '',
		type: 'video',
		metadata: {
			duration: 10, width: 1920, height: 1080, fps: 30,
			codec: 'h264', audioCodec: 'aac', bitrate: 0, fileSize: 0, format: 'video/mp4',
		},
		thumbnails: [],
		waveform: null,
		addedAt: 0,
		...over,
	};
}

function engine(bytes: Uint8Array): FFmpegEngine {
	return {
		readFile: vi.fn(async () => bytes.buffer as ArrayBuffer),
	} as unknown as FFmpegEngine;
}

describe('finding an asset the bytes', () => {
	it('uses the File when it actually holds something', async () => {
		const withBytes = asset({ file: new File([new Uint8Array(8)], 'clip.mp4') });

		expect((await assetBlob(withBytes)).size).toBe(8);
	});

	it('reads from the scratch copy when the File is a placeholder', async () => {
		// The OS-dialog and reopened-project cases: bytes on disk, empty File.
		const staged = asset({ scratchName: 'media_a1.mp4' });

		const blob = await assetBlob(staged, engine(new Uint8Array(16)));

		expect(blob.size).toBe(16);
	});

	it('prefers the File over a round trip through disk', async () => {
		const both = asset({
			file: new File([new Uint8Array(8)], 'clip.mp4'),
			scratchName: 'media_a1.mp4',
		});
		const ffmpeg = engine(new Uint8Array(16));

		await assetBlob(both, ffmpeg);

		expect(ffmpeg.readFile).not.toHaveBeenCalled();
	});

	it('falls back to the blob url, for the web build', async () => {
		const fetchMock = vi.fn(async () => new Response(new Uint8Array(4)));
		vi.stubGlobal('fetch', fetchMock);

		const web = asset({ blobUrl: 'blob:nowhere/1' });
		expect((await assetBlob(web)).size).toBe(4);

		vi.unstubAllGlobals();
	});

	it('says so plainly when there are no bytes anywhere', async () => {
		// Better than handing back an empty blob that fails later as a decode
		// error about a corrupt file.
		await expect(assetBlob(asset())).rejects.toThrow(/No bytes available for "clip.mp4"/);
	});

	it('does not reach for scratch without an engine to read it', async () => {
		await expect(assetBlob(asset({ scratchName: 'media_a1.mp4' }))).rejects.toThrow(
			/No bytes available/
		);
	});
});

describe('refusing to load something enormous', () => {
	/**
	 * Reading through the IPC costs a copy in Rust, one in transit and one in
	 * the page. A 978 MB source is three gigabytes before anything has decoded
	 * it — which is how a 50-minute clip took the whole app down.
	 */
	function sized(bytes: number): FFmpegEngine {
		return {
			fileSize: vi.fn(async () => bytes),
			readFile: vi.fn(async () => new Uint8Array(8).buffer as ArrayBuffer),
		} as unknown as FFmpegEngine;
	}

	it('reads a file of ordinary size', async () => {
		const staged = asset({ scratchName: 'media_a1.mp4' });

		expect((await assetBlob(staged, sized(50 * 1024 * 1024))).size).toBe(8);
	});

	it('refuses one that would not survive the copies', async () => {
		const staged = asset({ scratchName: 'media_a1.mp4' });

		await expect(assetBlob(staged, sized(978 * 1024 * 1024))).rejects.toThrow(/too large/);
	});

	it('says how big it is and what to do instead', async () => {
		const staged = asset({ scratchName: 'media_a1.mp4' });

		const error = await assetBlob(staged, sized(978 * 1024 * 1024)).catch((e) => e);

		expect(error.message).toContain('978 MB');
		expect(error.message).toContain('shorter section');
	});

	it('does not even attempt the read', async () => {
		const engine = sized(978 * 1024 * 1024);

		await assetBlob(asset({ scratchName: 'media_a1.mp4' }), engine).catch(() => {});

		expect(engine.readFile).not.toHaveBeenCalled();
	});
});
