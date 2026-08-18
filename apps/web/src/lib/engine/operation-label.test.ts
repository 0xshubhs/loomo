import { describe, it, expect } from 'vitest';
import { describeFfmpegOperation } from './operation-label.js';

describe('describeFfmpegOperation', () => {
	it('describes an export with its resolution', () => {
		// The exact argv that used to be printed at the user verbatim.
		const args = [
			'-i', 'src_0.mp4', '-t', '235.01',
			'-vf', 'scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2',
			'-c:v', 'libx264', 'output.mp4',
		];
		expect(describeFfmpegOperation(args)).toBe('Rendering video at 3840×2160');
	});

	it('falls back to a plain label when no scale is present', () => {
		expect(describeFfmpegOperation(['-i', 'a.mp4', '-c', 'copy', 'out.mov'])).toBe('Rendering video');
	});

	it('recognises the specialised jobs', () => {
		expect(describeFfmpegOperation(['-i', 'a.mp4', '-vf', 'fps=10,palettegen', 'p.png']))
			.toBe('Preparing GIF colours');
		expect(describeFfmpegOperation(['-i', 'a.mp4', '-lavfi', 'paletteuse', 'out.gif']))
			.toBe('Creating GIF');
		expect(describeFfmpegOperation(['-ss', '1', '-i', 'a.mp4', '-frames:v', '1', 't.jpg']))
			.toBe('Grabbing a frame');
		expect(describeFfmpegOperation(['-i', 'a.mp4', '-vn', '-c:a', 'pcm_s16le', 'a.wav']))
			.toBe('Extracting audio');
		expect(describeFfmpegOperation(['-f', 'concat', '-i', 'list.txt', 'out.mp4']))
			.toBe('Joining clips');
		expect(describeFfmpegOperation(['-i', 'a.wav', '-af', 'afftdn=nr=50', 'clean.wav']))
			.toBe('Cleaning up audio');
	});

	it('never leaks raw arguments', () => {
		const args = ['-i', 'secret_path.mp4', '-vf', 'scale=1920:1080', 'out.mp4'];
		const label = describeFfmpegOperation(args);
		expect(label).not.toContain('-i');
		expect(label).not.toContain('secret_path');
		expect(label).not.toContain('scale=');
	});

	it('degrades to a generic label rather than throwing', () => {
		expect(describeFfmpegOperation([])).toBe('Processing');
		expect(describeFfmpegOperation(['-version'])).toBe('Processing');
	});
});
