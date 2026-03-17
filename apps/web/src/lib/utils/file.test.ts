import { describe, it, expect } from 'vitest';
import { getFileType, getExtension, formatFileSize, isMediaFile } from './file';

function makeFile(name: string, type: string = ''): File {
	return new File([''], name, { type });
}

describe('getExtension', () => {
	it('extracts extension', () => {
		expect(getExtension('video.mp4')).toBe('mp4');
	});

	it('handles uppercase', () => {
		expect(getExtension('Video.MOV')).toBe('mov');
	});

	it('handles no extension', () => {
		expect(getExtension('README')).toBe('readme');
	});

	it('handles multiple dots', () => {
		expect(getExtension('archive.tar.gz')).toBe('gz');
	});
});

describe('getFileType', () => {
	it('detects video by extension', () => {
		expect(getFileType(makeFile('clip.mp4'))).toBe('video');
	});

	it('detects audio by extension', () => {
		expect(getFileType(makeFile('song.mp3'))).toBe('audio');
	});

	it('detects image by extension', () => {
		expect(getFileType(makeFile('photo.png'))).toBe('image');
	});

	it('falls back to mime type for video', () => {
		expect(getFileType(makeFile('file', 'video/webm'))).toBe('video');
	});

	it('falls back to mime type for audio', () => {
		expect(getFileType(makeFile('file', 'audio/ogg'))).toBe('audio');
	});

	it('falls back to mime type for image', () => {
		expect(getFileType(makeFile('file', 'image/jpeg'))).toBe('image');
	});

	it('returns unknown for unrecognized files', () => {
		expect(getFileType(makeFile('data.xyz', 'application/octet-stream'))).toBe('unknown');
	});
});

describe('formatFileSize', () => {
	it('formats bytes', () => {
		expect(formatFileSize(500)).toBe('500 B');
	});

	it('formats kilobytes', () => {
		expect(formatFileSize(1536)).toBe('1.5 KB');
	});

	it('formats megabytes', () => {
		expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
	});

	it('formats gigabytes', () => {
		expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
	});
});

describe('isMediaFile', () => {
	it('returns true for video', () => {
		expect(isMediaFile(makeFile('clip.webm'))).toBe(true);
	});

	it('returns true for audio', () => {
		expect(isMediaFile(makeFile('track.wav'))).toBe(true);
	});

	it('returns true for image', () => {
		expect(isMediaFile(makeFile('pic.jpg'))).toBe(true);
	});

	it('returns false for unknown', () => {
		expect(isMediaFile(makeFile('doc.pdf'))).toBe(false);
	});
});
