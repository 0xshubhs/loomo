export type FontCategory = 'sans-serif' | 'serif' | 'monospace' | 'display';

export interface FontOption {
	name: string;
	value: string;
	category: FontCategory;
}

export const FONT_LIST: FontOption[] = [
	{ name: 'Inter', value: 'Inter', category: 'sans-serif' },
	{ name: 'Roboto', value: 'Roboto', category: 'sans-serif' },
	{ name: 'Open Sans', value: 'Open Sans', category: 'sans-serif' },
	{ name: 'Montserrat', value: 'Montserrat', category: 'sans-serif' },
	{ name: 'Poppins', value: 'Poppins', category: 'sans-serif' },
	{ name: 'Lato', value: 'Lato', category: 'sans-serif' },
	{ name: 'Oswald', value: 'Oswald', category: 'display' },
	{ name: 'Playfair Display', value: 'Playfair Display', category: 'serif' },
	{ name: 'Merriweather', value: 'Merriweather', category: 'serif' },
	{ name: 'Source Code Pro', value: 'Source Code Pro', category: 'monospace' },
	{ name: 'Fira Code', value: 'Fira Code', category: 'monospace' },
	{ name: 'Arial', value: 'Arial', category: 'sans-serif' },
	{ name: 'Georgia', value: 'Georgia', category: 'serif' },
	{ name: 'Times New Roman', value: 'Times New Roman', category: 'serif' },
	{ name: 'Courier New', value: 'Courier New', category: 'monospace' },
	{ name: 'Impact', value: 'Impact', category: 'display' },
	{ name: 'Comic Sans MS', value: 'Comic Sans MS', category: 'display' },
];

/** Google Fonts that need to be loaded via the API (non-system fonts) */
export const GOOGLE_FONTS = FONT_LIST.filter(
	(f) => !['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'].includes(f.value)
);

/** Load a Google Font dynamically via the Google Fonts CSS API */
export function loadGoogleFont(fontFamily: string): void {
	const id = `google-font-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
	if (document.getElementById(id)) return;

	const link = document.createElement('link');
	link.id = id;
	link.rel = 'stylesheet';
	link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;500;700;900&display=swap`;
	document.head.appendChild(link);
}

/** Preload all Google Fonts so they are available in the editor */
export function preloadAllGoogleFonts(): void {
	for (const font of GOOGLE_FONTS) {
		loadGoogleFont(font.value);
	}
}
