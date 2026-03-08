export function formatTimecode(seconds: number, fps: number = 30): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const f = Math.floor((seconds % 1) * fps);
	return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
	return n.toString().padStart(2, '0');
}

export function secondsToPixels(seconds: number, pixelsPerSecond: number): number {
	return seconds * pixelsPerSecond;
}

export function pixelsToSeconds(pixels: number, pixelsPerSecond: number): number {
	return pixels / pixelsPerSecond;
}

export function snapToFrame(seconds: number, fps: number): number {
	return Math.round(seconds * fps) / fps;
}

export function clampTime(time: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, time));
}

export function formatRecordingTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function relativeTime(timestamp: number | string): string {
  const time = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const diff = Date.now() - time;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString();
}
