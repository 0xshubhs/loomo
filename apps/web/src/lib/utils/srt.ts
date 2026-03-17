import type { CaptionSegment } from '$lib/types/index.js';

/**
 * Format seconds into SRT timestamp format: HH:MM:SS,mmm
 */
function formatSrtTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds % 1) * 1000);

	return (
		String(h).padStart(2, '0') +
		':' +
		String(m).padStart(2, '0') +
		':' +
		String(s).padStart(2, '0') +
		',' +
		String(ms).padStart(3, '0')
	);
}

/**
 * Generate a valid SRT subtitle string from caption segments.
 */
export function exportSRT(segments: CaptionSegment[]): string {
	return segments
		.map((seg, i) => {
			const index = i + 1;
			const start = formatSrtTime(seg.startTime);
			const end = formatSrtTime(seg.endTime);
			return `${index}\n${start} --> ${end}\n${seg.text}\n`;
		})
		.join('\n');
}

/**
 * Trigger a download of the SRT file.
 */
export function downloadSRT(segments: CaptionSegment[], filename: string): void {
	const srtContent = exportSRT(segments);
	const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename.endsWith('.srt') ? filename : `${filename}.srt`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
