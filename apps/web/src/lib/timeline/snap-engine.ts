import type { SnapPoint } from '$lib/types/index.js';

export function findNearestSnapPoint(
	time: number,
	snapPoints: SnapPoint[],
	thresholdSeconds: number
): SnapPoint | null {
	let nearest: SnapPoint | null = null;
	let minDist = Infinity;

	for (const sp of snapPoints) {
		const dist = Math.abs(sp.time - time);
		if (dist < minDist && dist <= thresholdSeconds) {
			minDist = dist;
			nearest = sp;
		}
	}

	return nearest;
}

export function getSnapThresholdInSeconds(pixelsPerSecond: number, pixelThreshold: number = 10): number {
	return pixelThreshold / pixelsPerSecond;
}
