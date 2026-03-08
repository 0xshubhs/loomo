import { clamp } from '$lib/utils/math.js';

const MIN_ZOOM = 5;
const MAX_ZOOM = 500;
const ZOOM_FACTOR = 1.15;

export function calculateZoom(
	currentZoom: number,
	deltaY: number,
	mouseX: number,
	scrollX: number
): { zoom: number; scrollX: number } {
	const direction = deltaY > 0 ? -1 : 1;
	const newZoom = clamp(
		currentZoom * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR),
		MIN_ZOOM,
		MAX_ZOOM
	);

	// Keep the mouse position stable
	const timeAtMouse = (mouseX + scrollX) / currentZoom;
	const newScrollX = timeAtMouse * newZoom - mouseX;

	return { zoom: newZoom, scrollX: Math.max(0, newScrollX) };
}

export function zoomToFit(duration: number, viewWidth: number): { zoom: number; scrollX: number } {
	if (duration <= 0) return { zoom: 100, scrollX: 0 };
	const padding = 40;
	const zoom = clamp((viewWidth - padding) / duration, MIN_ZOOM, MAX_ZOOM);
	return { zoom, scrollX: 0 };
}
