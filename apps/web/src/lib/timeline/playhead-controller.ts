export function playheadToPixel(time: number, pixelsPerSecond: number, scrollX: number): number {
	return time * pixelsPerSecond - scrollX;
}

export function pixelToPlayhead(x: number, pixelsPerSecond: number, scrollX: number): number {
	return Math.max(0, (x + scrollX) / pixelsPerSecond);
}

export function ensurePlayheadVisible(
	currentTime: number,
	pixelsPerSecond: number,
	scrollX: number,
	viewWidth: number
): number {
	const playheadX = currentTime * pixelsPerSecond;
	const margin = 50;

	if (playheadX < scrollX + margin) {
		return Math.max(0, playheadX - margin);
	}
	if (playheadX > scrollX + viewWidth - margin) {
		return playheadX - viewWidth + margin;
	}

	return scrollX;
}
