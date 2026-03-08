export interface KeyBinding {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	action: string;
	description: string;
}

export const KEYBOARD_SHORTCUTS: KeyBinding[] = [
	{ key: ' ', action: 'playback.toggle', description: 'Play/Pause' },
	{ key: 's', action: 'timeline.split', description: 'Split at playhead' },
	{ key: 'Delete', action: 'timeline.delete', description: 'Delete selected' },
	{ key: 'Backspace', action: 'timeline.delete', description: 'Delete selected' },
	{ key: 'z', ctrl: true, action: 'history.undo', description: 'Undo' },
	{ key: 'z', ctrl: true, shift: true, action: 'history.redo', description: 'Redo' },
	{ key: 'y', ctrl: true, action: 'history.redo', description: 'Redo' },
	{ key: 'c', ctrl: true, action: 'clipboard.copy', description: 'Copy' },
	{ key: 'v', ctrl: true, action: 'clipboard.paste', description: 'Paste' },
	{ key: 'x', ctrl: true, action: 'clipboard.cut', description: 'Cut' },
	{ key: 'a', ctrl: true, action: 'selection.all', description: 'Select all' },
	{ key: 'Escape', action: 'selection.clear', description: 'Deselect all' },
	{ key: '=', ctrl: true, action: 'zoom.in', description: 'Zoom in' },
	{ key: '-', ctrl: true, action: 'zoom.out', description: 'Zoom out' },
	{ key: '0', ctrl: true, action: 'zoom.fit', description: 'Fit timeline' },
	{ key: 'Home', action: 'playback.start', description: 'Go to start' },
	{ key: 'End', action: 'playback.end', description: 'Go to end' },
	{ key: 'ArrowLeft', action: 'playback.framePrev', description: 'Previous frame' },
	{ key: 'ArrowRight', action: 'playback.frameNext', description: 'Next frame' },
	{ key: 'ArrowLeft', shift: true, action: 'playback.jumpPrev', description: 'Jump back 5s' },
	{ key: 'ArrowRight', shift: true, action: 'playback.jumpNext', description: 'Jump forward 5s' },
	{ key: 'e', ctrl: true, action: 'export.open', description: 'Export' },
	{ key: 'i', action: 'import.open', description: 'Import media' },
	{ key: 't', action: 'text.add', description: 'Add text overlay' },
	{ key: 'm', action: 'track.mute', description: 'Mute selected track' },
];

export function matchShortcut(e: KeyboardEvent): KeyBinding | undefined {
	const ctrl = e.ctrlKey || e.metaKey;
	const shift = e.shiftKey;
	const alt = e.altKey;

	return KEYBOARD_SHORTCUTS.find(
		(s) =>
			s.key === e.key &&
			(s.ctrl ?? false) === ctrl &&
			(s.shift ?? false) === shift &&
			(s.alt ?? false) === alt
	);
}
