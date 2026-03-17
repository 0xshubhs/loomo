export interface Shortcut {
	key: string;
	modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
	label: string;
	description: string;
	category: 'playback' | 'editing' | 'timeline' | 'tools' | 'general';
	action: string;
}

export const SHORTCUTS: Shortcut[] = [
	// Playback
	{ key: ' ', modifiers: [], label: 'Space', description: 'Play / Pause', category: 'playback', action: 'playback.toggle' },
	{ key: 'j', modifiers: [], label: 'J', description: 'Rewind', category: 'playback', action: 'playback.rewind' },
	{ key: 'k', modifiers: [], label: 'K', description: 'Pause', category: 'playback', action: 'playback.pause' },
	{ key: 'l', modifiers: [], label: 'L', description: 'Forward', category: 'playback', action: 'playback.forward' },
	{ key: 'ArrowLeft', modifiers: [], label: 'Left', description: 'Frame back', category: 'playback', action: 'playback.framePrev' },
	{ key: 'ArrowRight', modifiers: [], label: 'Right', description: 'Frame forward', category: 'playback', action: 'playback.frameNext' },
	{ key: 'ArrowLeft', modifiers: ['shift'], label: 'Shift+Left', description: 'Jump back 5s', category: 'playback', action: 'playback.jumpPrev' },
	{ key: 'ArrowRight', modifiers: ['shift'], label: 'Shift+Right', description: 'Jump forward 5s', category: 'playback', action: 'playback.jumpNext' },
	{ key: 'Home', modifiers: [], label: 'Home', description: 'Go to start', category: 'playback', action: 'playback.start' },
	{ key: 'End', modifiers: [], label: 'End', description: 'Go to end', category: 'playback', action: 'playback.end' },

	// Editing
	{ key: 'z', modifiers: ['ctrl'], label: 'Ctrl+Z', description: 'Undo last action', category: 'editing', action: 'history.undo' },
	{ key: 'z', modifiers: ['ctrl', 'shift'], label: 'Ctrl+Shift+Z', description: 'Redo last action', category: 'editing', action: 'history.redo' },
	{ key: 'y', modifiers: ['ctrl'], label: 'Ctrl+Y', description: 'Redo last action', category: 'editing', action: 'history.redo' },
	{ key: 'c', modifiers: ['ctrl'], label: 'Ctrl+C', description: 'Copy selection', category: 'editing', action: 'clipboard.copy' },
	{ key: 'v', modifiers: ['ctrl'], label: 'Ctrl+V', description: 'Paste', category: 'editing', action: 'clipboard.paste' },
	{ key: 'x', modifiers: ['ctrl'], label: 'Ctrl+X', description: 'Cut selection', category: 'editing', action: 'clipboard.cut' },
	{ key: 'Delete', modifiers: [], label: 'Delete', description: 'Delete selected', category: 'editing', action: 'timeline.delete' },
	{ key: 'Backspace', modifiers: [], label: 'Backspace', description: 'Delete selected', category: 'editing', action: 'timeline.delete' },
	{ key: 'a', modifiers: ['ctrl'], label: 'Ctrl+A', description: 'Select all clips', category: 'editing', action: 'selection.all' },
	{ key: 'd', modifiers: ['ctrl'], label: 'Ctrl+D', description: 'Duplicate selected clips', category: 'editing', action: 'editing.duplicate' },

	// Timeline
	{ key: 's', modifiers: [], label: 'S', description: 'Split at playhead', category: 'timeline', action: 'timeline.split' },
	{ key: '=', modifiers: [], label: '+', description: 'Zoom in timeline', category: 'timeline', action: 'zoom.in' },
	{ key: '-', modifiers: [], label: '-', description: 'Zoom out timeline', category: 'timeline', action: 'zoom.out' },
	{ key: 'f', modifiers: ['ctrl', 'shift'], label: 'Ctrl+Shift+F', description: 'Fit timeline to view', category: 'timeline', action: 'zoom.fit' },
	{ key: '[', modifiers: [], label: '[', description: 'Set in point', category: 'timeline', action: 'timeline.inPoint' },
	{ key: ']', modifiers: [], label: ']', description: 'Set out point', category: 'timeline', action: 'timeline.outPoint' },

	// Tools
	{ key: 'v', modifiers: [], label: 'V', description: 'Select tool', category: 'tools', action: 'tool.select' },
	{ key: 'c', modifiers: [], label: 'C', description: 'Razor / cut tool', category: 'tools', action: 'tool.razor' },
	{ key: 't', modifiers: [], label: 'T', description: 'Add text overlay', category: 'tools', action: 'text.add' },
	{ key: 'm', modifiers: [], label: 'M', description: 'Add marker', category: 'tools', action: 'marker.add' },

	// Timeline (continued)
	{ key: 'g', modifiers: ['ctrl'], label: 'Ctrl+G', description: 'Group selected clips', category: 'timeline', action: 'timeline.group' },
	{ key: 'g', modifiers: ['ctrl', 'shift'], label: 'Ctrl+Shift+G', description: 'Ungroup clips', category: 'timeline', action: 'timeline.ungroup' },
	{ key: '0', modifiers: ['ctrl'], label: 'Ctrl+0', description: 'Zoom to fit', category: 'timeline', action: 'zoom.fit' },
	{ key: 'g', modifiers: [], label: 'G', description: 'Remove all gaps', category: 'timeline', action: 'timeline.removeGaps' },

	// General
	{ key: '?', modifiers: [], label: '?', description: 'Show keyboard shortcuts', category: 'general', action: 'shortcuts.show' },
	{ key: 's', modifiers: ['ctrl'], label: 'Ctrl+S', description: 'Save project', category: 'general', action: 'project.save' },
	{ key: 'e', modifiers: ['ctrl'], label: 'Ctrl+E', description: 'Export video', category: 'general', action: 'export.open' },
	{ key: 'n', modifiers: ['ctrl'], label: 'Ctrl+N', description: 'New project', category: 'general', action: 'project.new' },
	{ key: 'f', modifiers: [], label: 'F', description: 'Toggle fullscreen preview', category: 'general', action: 'preview.fullscreen' },
	{ key: 'm', modifiers: ['ctrl', 'shift'], label: 'Ctrl+Shift+M', description: 'Toggle mute', category: 'general', action: 'audio.toggleMute' },
	{ key: 'i', modifiers: [], label: 'I', description: 'Import media', category: 'general', action: 'import.open' },
	{ key: 'f', modifiers: ['ctrl', 'alt'], label: 'Ctrl+Alt+F', description: 'Toggle sidebar & timeline', category: 'general', action: 'panels.toggleAll' },
	{ key: '2', modifiers: ['ctrl', 'alt'], label: 'Ctrl+Alt+2', description: 'Toggle sidebar', category: 'general', action: 'panels.toggleSidebar' },
	{ key: '3', modifiers: ['ctrl', 'alt'], label: 'Ctrl+Alt+3', description: 'Toggle timeline', category: 'general', action: 'panels.toggleTimeline' },
];

export type ShortcutCategory = Shortcut['category'];

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
	playback: 'Playback',
	editing: 'Editing',
	timeline: 'Timeline',
	tools: 'Tools',
	general: 'General',
};

export function getShortcutsByCategory(): { category: ShortcutCategory; label: string; shortcuts: Shortcut[] }[] {
	const categories: ShortcutCategory[] = ['playback', 'editing', 'timeline', 'tools', 'general'];
	return categories.map((category) => ({
		category,
		label: CATEGORY_LABELS[category],
		shortcuts: SHORTCUTS.filter((s) => s.category === category),
	}));
}

export function getShortcutLabel(action: string): string | undefined {
	const shortcut = SHORTCUTS.find((s) => s.action === action);
	return shortcut?.label;
}

/** Legacy-compatible interface */
export interface KeyBinding {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	action: string;
	description: string;
}

/** Convert new Shortcut format to legacy KeyBinding for backward compat */
function shortcutToKeyBinding(s: Shortcut): KeyBinding {
	return {
		key: s.key,
		ctrl: s.modifiers?.includes('ctrl') || s.modifiers?.includes('meta'),
		shift: s.modifiers?.includes('shift'),
		alt: s.modifiers?.includes('alt'),
		action: s.action,
		description: s.description,
	};
}

export const KEYBOARD_SHORTCUTS: KeyBinding[] = SHORTCUTS.map(shortcutToKeyBinding);

export function matchShortcut(e: KeyboardEvent): KeyBinding | undefined {
	const ctrl = e.ctrlKey || e.metaKey;
	const shift = e.shiftKey;
	const alt = e.altKey;

	return KEYBOARD_SHORTCUTS.find(
		(s) =>
			s.key.toLowerCase() === e.key.toLowerCase() &&
			(s.ctrl ?? false) === ctrl &&
			(s.shift ?? false) === shift &&
			(s.alt ?? false) === alt
	);
}
