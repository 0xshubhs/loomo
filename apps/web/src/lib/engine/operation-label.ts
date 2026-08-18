/**
 * Human descriptions of what FFmpeg is currently doing.
 *
 * The status bar used to print the argv verbatim — "FFmpeg: -i src_0.mp4 -t
 * 235.01 -vf scale=3840:2160:force_original_aspect_ratio=decrease,pad=…".
 * That is a build artefact leaking into the product: it means nothing to
 * someone exporting a video, and it looks broken. The same information is
 * still available in the diagnostics log for debugging.
 */

const VIDEO_CONTAINERS = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];

/** Output path is the last argument that is not a flag or a flag's value. */
function outputPath(args: string[]): string {
	const last = args[args.length - 1];
	return last && !last.startsWith('-') ? last.toLowerCase() : '';
}

function resolutionOf(args: string[]): string | null {
	for (const arg of args) {
		// Matches the leading scale=W:H of a filter chain.
		const match = /(?:^|,)scale=(\d{2,5}):(\d{2,5})/.exec(arg);
		if (match) return `${match[1]}×${match[2]}`;
	}
	return null;
}

export function describeFfmpegOperation(args: string[]): string {
	const output = outputPath(args);
	const has = (flag: string) => args.includes(flag);

	// Order matters: the most specific job wins.
	if (args.some((a) => a.includes('palettegen'))) return 'Preparing GIF colours';
	if (output.endsWith('.gif')) return 'Creating GIF';
	if (has('-frames:v') || args.some((a) => a.includes('image2pipe'))) return 'Grabbing a frame';
	if (has('-vn')) return 'Extracting audio';
	if (has('-f') && args.includes('concat')) return 'Joining clips';
	if (args.some((a) => a.includes('afftdn'))) return 'Cleaning up audio';

	if (VIDEO_CONTAINERS.some((ext) => output.endsWith(ext)) || output.endsWith('.m4a')) {
		const resolution = resolutionOf(args);
		return resolution ? `Rendering video at ${resolution}` : 'Rendering video';
	}

	return 'Processing';
}
