import type { Track, Clip, SnapPoint } from '$lib/types/index.js';

export function getClipAtTime(tracks: Track[], trackIndex: number, time: number): Clip | null {
	if (trackIndex < 0 || trackIndex >= tracks.length) return null;
	const track = tracks[trackIndex];
	return (
		track.clips.find((c) => time >= c.timelineStart && time <= c.timelineStart + c.duration) ?? null
	);
}

export function getClipAtPosition(
	tracks: Track[],
	x: number,
	y: number,
	pixelsPerSecond: number,
	scrollX: number,
	scrollY: number,
	trackHeight: number,
	trackGap: number,
	rulerHeight: number
): { clip: Clip; track: Track; edge: 'start' | 'end' | 'body' } | null {
	const time = (x + scrollX) / pixelsPerSecond;
	const adjustedY = y - rulerHeight + scrollY;
	const trackIndex = Math.floor(adjustedY / (trackHeight + trackGap));

	if (trackIndex < 0 || trackIndex >= tracks.length) return null;

	const track = tracks[trackIndex];
	if (track.locked) return null;

	for (const clip of track.clips) {
		const clipStart = clip.timelineStart;
		const clipEnd = clipStart + clip.duration;

		if (time >= clipStart && time <= clipEnd) {
			const clipStartPx = clipStart * pixelsPerSecond - scrollX;
			const clipEndPx = clipEnd * pixelsPerSecond - scrollX;
			const edgeThreshold = 8;

			let edge: 'start' | 'end' | 'body' = 'body';
			if (x - clipStartPx < edgeThreshold) edge = 'start';
			else if (clipEndPx - x < edgeThreshold) edge = 'end';

			return { clip, track, edge };
		}
	}

	return null;
}

export function getSnapPoints(tracks: Track[], excludeClipId?: string): SnapPoint[] {
	const points: SnapPoint[] = [];

	for (const track of tracks) {
		for (const clip of track.clips) {
			if (clip.id === excludeClipId) continue;
			points.push({
				time: clip.timelineStart,
				source: 'clip-start',
				clipId: clip.id,
			});
			points.push({
				time: clip.timelineStart + clip.duration,
				source: 'clip-end',
				clipId: clip.id,
			});
		}
	}

	return points;
}

export function findNearestSnap(
	time: number,
	snapPoints: SnapPoint[],
	threshold: number
): { time: number; snapped: boolean } {
	let nearest: SnapPoint | null = null;
	let minDistance = Infinity;

	for (const point of snapPoints) {
		const distance = Math.abs(point.time - time);
		if (distance < minDistance && distance < threshold) {
			minDistance = distance;
			nearest = point;
		}
	}

	return nearest ? { time: nearest.time, snapped: true } : { time, snapped: false };
}

export function getTrackIndexFromY(
	y: number,
	trackHeight: number,
	trackGap: number,
	rulerHeight: number,
	scrollY: number,
	trackCount: number
): number {
	const adjusted = y - rulerHeight + scrollY;
	const idx = Math.floor(adjusted / (trackHeight + trackGap));
	return Math.max(0, Math.min(trackCount - 1, idx));
}
