export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
	return (value - a) / (b - a);
}

export function remap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
	const t = inverseLerp(fromMin, fromMax, value);
	return lerp(toMin, toMax, t);
}

export function roundTo(value: number, decimals: number): number {
	const factor = Math.pow(10, decimals);
	return Math.round(value * factor) / factor;
}
