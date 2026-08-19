import { describe, it, expect } from 'vitest';
import { basename, extname, typeFromPath, scratchExtension } from './pick.js';

/**
 * Paths come back from the OS dialog untouched, so these have to cope with
 * whatever a real filename contains. The bug that prompted all of this was a
 * literal `%20` in a name: WebKitGTK percent-decoded it, found nothing on disk
 * by the decoded name, and handed the page a zero-byte `File`.
 */

describe('reading a path', () => {
	it('takes the last segment', () => {
		expect(basename('/home/k/Downloads/clip.mp4')).toBe('clip.mp4');
	});

	it('handles Windows separators', () => {
		expect(basename('C:\\Users\\k\\clip.mp4')).toBe('clip.mp4');
	});

	it('leaves a bare filename alone', () => {
		expect(basename('clip.mp4')).toBe('clip.mp4');
	});

	it('keeps a percent-encoded name exactly as it is on disk', () => {
		// Decoding this is the entire bug. The name is literally these bytes.
		expect(basename('/home/k/Members%20Only%20S2.mp4')).toBe('Members%20Only%20S2.mp4');
	});

	it('keeps spaces, brackets and dots', () => {
		expect(basename('/home/k/Members Only S2 Ep 2.Sourav (1).mp4')).toBe(
			'Members Only S2 Ep 2.Sourav (1).mp4'
		);
	});

	it('copes with a name that is all extension', () => {
		expect(basename('/home/k/.hidden')).toBe('.hidden');
	});
});

describe('reading an extension', () => {
	it('lowercases it', () => {
		expect(extname('/home/k/CLIP.MP4')).toBe('.mp4');
	});

	it('takes the last one', () => {
		expect(extname('/home/k/Ep 2.Sourav.mp4')).toBe('.mp4');
	});

	it('is empty when there is none', () => {
		expect(extname('/home/k/recording')).toBe('');
	});

	it('does not treat a leading dot as an extension', () => {
		// `.hidden` is a name, not an extension.
		expect(extname('/home/k/.hidden')).toBe('');
	});
});

describe('deciding what a file is', () => {
	it('recognises video, audio and images', () => {
		expect(typeFromPath('/a/b.mp4')).toBe('video');
		expect(typeFromPath('/a/b.m4a')).toBe('audio');
		expect(typeFromPath('/a/b.PNG')).toBe('image');
	});

	it('recognises a name with dots in it', () => {
		expect(typeFromPath('/a/Members Only S2 Episode 2.Sourav.mkv')).toBe('video');
	});

	it('says nothing useful about an unknown extension', () => {
		expect(typeFromPath('/a/notes.txt')).toBe('unknown');
		expect(typeFromPath('/a/recording')).toBe('unknown');
	});
});

describe('naming the scratch copy', () => {
	/**
	 * ffmpeg picks its demuxer from the extension, so it has to survive — but
	 * the user's filename is not a safe source of one. Scratch names are built
	 * by concatenation and handed to a process.
	 */
	it('keeps the extension, because ffmpeg reads it', () => {
		expect(scratchExtension('/a/clip.mkv')).toBe('.mkv');
	});

	it('lowercases it', () => {
		expect(scratchExtension('/a/clip.MOV')).toBe('.mov');
	});

	it('strips anything that is not a letter or digit', () => {
		expect(scratchExtension('/a/clip.m p4')).toBe('.mp4');
		expect(scratchExtension("/a/clip.mp'4")).toBe('.mp4');
		expect(scratchExtension('/a/clip.mp4\n')).toBe('.mp4');
	});

	it('falls back for a file with no extension', () => {
		expect(scratchExtension('/a/recording')).toBe('.bin');
	});

	it('falls back when the extension is nothing but punctuation', () => {
		expect(scratchExtension('/a/clip.---')).toBe('.bin');
	});

	it('caps a preposterous extension', () => {
		expect(scratchExtension(`/a/clip.${'x'.repeat(300)}`)).toBe(`.${'x'.repeat(8)}`);
	});

	it('leaves a percent-encoded name with its real extension', () => {
		expect(scratchExtension('/a/Members%20Only%20S2.mp4')).toBe('.mp4');
	});
});
