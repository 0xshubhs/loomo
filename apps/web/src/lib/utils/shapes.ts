export interface ShapeDefinition {
	id: string;
	name: string;
	category: string;
	path: string;
	viewBox: string;
}

export const SHAPES: ShapeDefinition[] = [
	// ── Basic (10) ──────────────────────────────────────────────────
	{
		id: 'rectangle',
		name: 'Rectangle',
		category: 'Basic',
		path: 'M 2 2 H 98 V 98 H 2 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'rounded-rect',
		name: 'Rounded Rect',
		category: 'Basic',
		path: 'M 15 2 H 85 Q 98 2 98 15 V 85 Q 98 98 85 98 H 15 Q 2 98 2 85 V 15 Q 2 2 15 2 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'circle',
		name: 'Circle',
		category: 'Basic',
		path: 'M 50 2 A 48 48 0 1 1 50 98 A 48 48 0 1 1 50 2 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'ellipse',
		name: 'Ellipse',
		category: 'Basic',
		path: 'M 50 15 A 45 35 0 1 1 50 85 A 45 35 0 1 1 50 15 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'triangle',
		name: 'Triangle',
		category: 'Basic',
		path: 'M 50 5 L 95 95 H 5 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'diamond',
		name: 'Diamond',
		category: 'Basic',
		path: 'M 50 2 L 98 50 L 50 98 L 2 50 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'pentagon',
		name: 'Pentagon',
		category: 'Basic',
		path: 'M 50 2 L 97 36 L 79 95 H 21 L 3 36 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'hexagon',
		name: 'Hexagon',
		category: 'Basic',
		path: 'M 50 2 L 93 27 V 73 L 50 98 L 7 73 V 27 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'star',
		name: 'Star',
		category: 'Basic',
		path: 'M 50 2 L 63 38 H 98 L 69 60 L 80 96 L 50 74 L 20 96 L 31 60 L 2 38 H 37 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'cross',
		name: 'Cross',
		category: 'Basic',
		path: 'M 35 2 H 65 V 35 H 98 V 65 H 65 V 98 H 35 V 65 H 2 V 35 H 35 Z',
		viewBox: '0 0 100 100',
	},

	// ── Arrows (8) ──────────────────────────────────────────────────
	{
		id: 'arrow-right',
		name: 'Arrow Right',
		category: 'Arrows',
		path: 'M 2 40 H 60 V 20 L 98 50 L 60 80 V 60 H 2 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'arrow-left',
		name: 'Arrow Left',
		category: 'Arrows',
		path: 'M 98 40 H 40 V 20 L 2 50 L 40 80 V 60 H 98 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'arrow-up',
		name: 'Arrow Up',
		category: 'Arrows',
		path: 'M 40 98 V 40 H 20 L 50 2 L 80 40 H 60 V 98 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'arrow-down',
		name: 'Arrow Down',
		category: 'Arrows',
		path: 'M 40 2 V 60 H 20 L 50 98 L 80 60 H 60 V 2 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'arrow-curved-right',
		name: 'Curved Arrow',
		category: 'Arrows',
		path: 'M 15 80 Q 15 20 55 20 V 5 L 95 30 L 55 55 V 40 Q 35 40 35 80 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'chevron-right',
		name: 'Chevron Right',
		category: 'Arrows',
		path: 'M 25 5 L 75 50 L 25 95 L 15 85 L 55 50 L 15 15 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'chevron-double-right',
		name: 'Double Chevron',
		category: 'Arrows',
		path: 'M 10 5 L 50 50 L 10 95 L 2 85 L 35 50 L 2 15 Z M 50 5 L 90 50 L 50 95 L 42 85 L 75 50 L 42 15 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'arrow-circle',
		name: 'Arrow Circle',
		category: 'Arrows',
		path: 'M 50 5 A 45 45 0 1 1 15 25 L 5 15 L 25 10 L 20 32 L 15 25 A 45 45 0 1 0 50 5 Z',
		viewBox: '0 0 100 100',
	},

	// ── Callouts (8) ────────────────────────────────────────────────
	{
		id: 'speech-bubble',
		name: 'Speech Bubble',
		category: 'Callouts',
		path: 'M 10 5 H 90 Q 98 5 98 13 V 60 Q 98 68 90 68 H 45 L 25 90 L 30 68 H 10 Q 2 68 2 60 V 13 Q 2 5 10 5 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'speech-bubble-round',
		name: 'Round Speech',
		category: 'Callouts',
		path: 'M 50 5 C 80 5 98 20 98 40 C 98 60 80 75 50 75 C 45 75 40 74 36 73 L 20 90 L 25 72 C 10 66 2 54 2 40 C 2 20 20 5 50 5 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'thought-bubble',
		name: 'Thought Bubble',
		category: 'Callouts',
		path: 'M 50 8 C 75 8 95 22 95 42 C 95 62 75 72 50 72 C 25 72 5 62 5 42 C 5 22 25 8 50 8 Z M 30 75 A 6 6 0 1 1 30 87 A 6 6 0 1 1 30 75 Z M 20 88 A 4 4 0 1 1 20 96 A 4 4 0 1 1 20 88 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'callout-arrow',
		name: 'Callout Arrow',
		category: 'Callouts',
		path: 'M 5 5 H 95 V 65 H 55 L 35 90 L 40 65 H 5 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'banner',
		name: 'Banner',
		category: 'Callouts',
		path: 'M 5 20 L 15 10 V 25 H 85 V 10 L 95 20 L 85 30 V 75 H 15 V 30 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'ribbon',
		name: 'Ribbon',
		category: 'Callouts',
		path: 'M 2 30 L 15 35 V 65 L 2 70 Z M 15 25 H 85 V 75 H 15 Z M 85 30 L 98 35 V 65 L 85 70 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'badge',
		name: 'Badge',
		category: 'Callouts',
		path: 'M 50 2 L 60 20 L 80 10 L 75 32 L 98 35 L 82 50 L 98 65 L 75 68 L 80 90 L 60 80 L 50 98 L 40 80 L 20 90 L 25 68 L 2 65 L 18 50 L 2 35 L 25 32 L 20 10 L 40 20 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'seal',
		name: 'Seal',
		category: 'Callouts',
		path: 'M 50 2 L 56 18 L 72 8 L 68 26 L 86 22 L 76 38 L 94 40 L 80 50 L 94 60 L 76 62 L 86 78 L 68 74 L 72 92 L 56 82 L 50 98 L 44 82 L 28 92 L 32 74 L 14 78 L 24 62 L 6 60 L 20 50 L 6 40 L 24 38 L 14 22 L 32 26 L 28 8 L 44 18 Z',
		viewBox: '0 0 100 100',
	},

	// ── Social (8) ──────────────────────────────────────────────────
	{
		id: 'heart',
		name: 'Heart',
		category: 'Social',
		path: 'M 50 88 C 20 70 2 52 2 32 C 2 16 14 4 30 4 C 40 4 48 10 50 18 C 52 10 60 4 70 4 C 86 4 98 16 98 32 C 98 52 80 70 50 88 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'thumbs-up',
		name: 'Thumbs Up',
		category: 'Social',
		path: 'M 30 45 V 90 H 10 V 45 Z M 35 45 L 40 18 C 42 8 55 8 55 18 V 38 H 85 C 90 38 93 44 91 49 L 80 85 C 78 90 73 93 68 93 H 35 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'lightning',
		name: 'Lightning',
		category: 'Social',
		path: 'M 55 2 L 25 52 H 45 L 35 98 L 78 42 H 55 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'flame',
		name: 'Flame',
		category: 'Social',
		path: 'M 50 2 C 58 25 80 35 80 58 C 80 78 67 95 50 95 C 33 95 20 78 20 58 C 20 45 30 38 38 30 C 35 45 42 55 50 55 C 55 55 58 48 55 35 C 65 40 70 50 70 58 C 70 72 62 82 50 82 C 40 82 34 72 34 62 C 34 50 42 35 50 2 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'music',
		name: 'Music',
		category: 'Social',
		path: 'M 72 10 V 70 C 72 82 60 90 50 88 C 40 86 35 76 40 68 C 45 60 58 58 65 62 V 25 L 38 32 V 80 C 38 92 26 98 16 96 C 6 94 2 84 7 76 C 12 68 24 66 32 70 V 18 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'camera',
		name: 'Camera',
		category: 'Social',
		path: 'M 35 20 L 40 10 H 60 L 65 20 H 90 Q 98 20 98 28 V 82 Q 98 90 90 90 H 10 Q 2 90 2 82 V 28 Q 2 20 10 20 Z M 50 35 A 20 20 0 1 0 50 75 A 20 20 0 1 0 50 35 Z M 50 42 A 13 13 0 1 1 50 68 A 13 13 0 1 1 50 42 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'play',
		name: 'Play',
		category: 'Social',
		path: 'M 50 2 A 48 48 0 1 1 50 98 A 48 48 0 1 1 50 2 Z M 38 25 L 78 50 L 38 75 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'check-circle',
		name: 'Check Circle',
		category: 'Social',
		path: 'M 50 2 A 48 48 0 1 1 50 98 A 48 48 0 1 1 50 2 Z M 25 50 L 42 68 L 75 32',
		viewBox: '0 0 100 100',
	},

	// ── Hand-drawn (6) ──────────────────────────────────────────────
	{
		id: 'scribble-circle',
		name: 'Scribble Circle',
		category: 'Hand-drawn',
		path: 'M 50 8 C 20 5 5 25 6 50 C 7 75 25 94 52 95 C 78 96 96 78 97 50 C 98 22 78 4 50 8 C 40 10 12 22 10 50 C 8 78 28 92 50 92',
		viewBox: '0 0 100 100',
	},
	{
		id: 'scribble-underline',
		name: 'Scribble Underline',
		category: 'Hand-drawn',
		path: 'M 5 55 C 20 50 40 52 60 48 C 75 45 90 50 95 52 M 8 60 C 25 55 45 58 65 54 C 80 51 92 55 95 58',
		viewBox: '0 0 100 100',
	},
	{
		id: 'scribble-arrow',
		name: 'Scribble Arrow',
		category: 'Hand-drawn',
		path: 'M 10 70 C 25 65 45 55 60 45 C 70 38 80 30 90 22 M 70 18 L 92 20 L 88 42',
		viewBox: '0 0 100 100',
	},
	{
		id: 'scribble-star',
		name: 'Scribble Star',
		category: 'Hand-drawn',
		path: 'M 50 5 L 58 35 C 60 36 62 37 64 38 L 95 38 L 70 56 C 68 58 68 60 69 62 L 80 92 L 52 72 C 50 71 48 71 46 72 L 18 92 L 30 62 C 31 60 30 58 28 56 L 5 38 L 36 38 C 38 37 40 36 41 35 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'scribble-check',
		name: 'Scribble Check',
		category: 'Hand-drawn',
		path: 'M 10 55 C 18 52 25 58 35 65 C 42 70 48 72 50 68 C 55 58 65 35 75 25 C 82 18 88 15 92 12',
		viewBox: '0 0 100 100',
	},
	{
		id: 'scribble-x',
		name: 'Scribble X',
		category: 'Hand-drawn',
		path: 'M 15 15 C 25 28 40 42 55 58 C 65 68 78 80 88 88 M 85 15 C 75 28 60 42 48 55 C 38 65 25 78 15 88',
		viewBox: '0 0 100 100',
	},

	// ── Decorative (6) ──────────────────────────────────────────────
	{
		id: 'sparkle',
		name: 'Sparkle',
		category: 'Decorative',
		path: 'M 50 2 C 52 30 55 35 70 38 C 55 41 52 46 50 70 C 48 46 45 41 30 38 C 45 35 48 30 50 2 Z M 75 55 C 76 68 77 70 85 72 C 77 74 76 76 75 88 C 74 76 73 74 65 72 C 73 70 74 68 75 55 Z M 25 60 C 26 70 27 72 35 74 C 27 76 26 78 25 88 C 24 78 23 76 15 74 C 23 72 24 70 25 60 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'burst',
		name: 'Burst',
		category: 'Decorative',
		path: 'M 50 2 L 55 35 L 82 8 L 62 38 L 98 30 L 68 48 L 98 65 L 62 58 L 82 90 L 55 62 L 50 98 L 45 62 L 18 90 L 38 58 L 2 65 L 32 48 L 2 30 L 38 38 L 18 8 L 45 35 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'wave',
		name: 'Wave',
		category: 'Decorative',
		path: 'M 0 50 C 10 30 20 30 30 50 C 40 70 50 70 60 50 C 70 30 80 30 90 50 C 95 60 100 60 100 50 V 90 H 0 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'zigzag',
		name: 'Zigzag',
		category: 'Decorative',
		path: 'M 0 40 L 12 20 L 25 40 L 37 20 L 50 40 L 62 20 L 75 40 L 87 20 L 100 40 V 60 L 87 80 L 75 60 L 62 80 L 50 60 L 37 80 L 25 60 L 12 80 L 0 60 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'confetti',
		name: 'Confetti',
		category: 'Decorative',
		path: 'M 20 10 L 25 5 L 30 15 L 25 20 Z M 50 8 L 55 3 L 58 12 L 53 15 Z M 75 12 L 80 6 L 84 16 L 79 20 Z M 10 35 L 15 28 L 20 38 L 15 42 Z M 85 30 L 90 24 L 95 34 L 90 38 Z M 30 55 L 35 48 L 40 58 L 35 62 Z M 65 50 L 70 44 L 74 54 L 69 58 Z M 15 72 L 20 66 L 24 76 L 19 80 Z M 45 75 L 50 68 L 55 78 L 50 82 Z M 78 70 L 83 64 L 88 74 L 83 78 Z M 55 90 L 60 84 L 65 94 L 60 98 Z',
		viewBox: '0 0 100 100',
	},
	{
		id: 'frame',
		name: 'Frame',
		category: 'Decorative',
		path: 'M 5 5 H 95 V 95 H 5 Z M 15 15 V 85 H 85 V 15 Z',
		viewBox: '0 0 100 100',
	},
];

const CATEGORIES = ['Basic', 'Arrows', 'Callouts', 'Social', 'Hand-drawn', 'Decorative'] as const;

export type ShapeCategory = (typeof CATEGORIES)[number];

export function getShapesByCategory(): Map<ShapeCategory, ShapeDefinition[]> {
	const map = new Map<ShapeCategory, ShapeDefinition[]>();
	for (const cat of CATEGORIES) {
		map.set(cat, SHAPES.filter((s) => s.category === cat));
	}
	return map;
}

export function getShapeById(id: string): ShapeDefinition | undefined {
	return SHAPES.find((s) => s.id === id);
}

export function getCategories(): ShapeCategory[] {
	return [...CATEGORIES];
}
