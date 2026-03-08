const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'ogv', 'ts', 'mts'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'wma', 'm4a', 'opus'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff'];

export function getFileType(file: File): 'video' | 'audio' | 'image' | 'unknown' {
	const ext = getExtension(file.name);
	if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
	if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
	if (IMAGE_EXTENSIONS.includes(ext)) return 'image';

	if (file.type.startsWith('video/')) return 'video';
	if (file.type.startsWith('audio/')) return 'audio';
	if (file.type.startsWith('image/')) return 'image';

	return 'unknown';
}

export function getExtension(filename: string): string {
	return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isMediaFile(file: File): boolean {
	return getFileType(file) !== 'unknown';
}
