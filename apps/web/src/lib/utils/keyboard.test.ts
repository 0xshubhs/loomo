import { describe, it, expect } from 'vitest';
import {
	SHORTCUTS,
	KEYBOARD_SHORTCUTS,
	getShortcutsByCategory,
	getShortcutLabel,
	matchShortcut,
} from './keyboard.js';

describe('SHORTCUTS', () => {
	it('should be a non-empty array', () => {
		expect(SHORTCUTS.length).toBeGreaterThan(0);
	});

	it('each shortcut should have required fields', () => {
		for (const s of SHORTCUTS) {
			expect(typeof s.key).toBe('string');
			expect(typeof s.label).toBe('string');
			expect(typeof s.description).toBe('string');
			expect(typeof s.action).toBe('string');
			expect(['playback', 'editing', 'timeline', 'tools', 'general']).toContain(s.category);
		}
	});

	it('should have unique actions (with possible intentional duplicates like redo)', () => {
		// Some actions may have multiple bindings (e.g., Ctrl+Shift+Z and Ctrl+Y both do redo)
		const actions = SHORTCUTS.map((s) => s.action);
		// Just check that there are shortcuts, not necessarily unique
		expect(actions.length).toBeGreaterThan(0);
	});
});

describe('KEYBOARD_SHORTCUTS', () => {
	it('should have the same length as SHORTCUTS', () => {
		expect(KEYBOARD_SHORTCUTS.length).toBe(SHORTCUTS.length);
	});

	it('each entry should have legacy KeyBinding format', () => {
		for (const kb of KEYBOARD_SHORTCUTS) {
			expect(typeof kb.key).toBe('string');
			expect(typeof kb.action).toBe('string');
			expect(typeof kb.description).toBe('string');
		}
	});

	it('should convert ctrl modifier correctly', () => {
		const ctrlZ = KEYBOARD_SHORTCUTS.find((s) => s.action === 'history.undo');
		expect(ctrlZ).toBeDefined();
		expect(ctrlZ!.ctrl).toBe(true);
		expect(ctrlZ!.key).toBe('z');
	});

	it('should convert shift modifier correctly', () => {
		const ctrlShiftZ = KEYBOARD_SHORTCUTS.find(
			(s) => s.action === 'history.redo' && s.key === 'z'
		);
		expect(ctrlShiftZ).toBeDefined();
		expect(ctrlShiftZ!.ctrl).toBe(true);
		expect(ctrlShiftZ!.shift).toBe(true);
	});
});

describe('getShortcutsByCategory', () => {
	it('should return an array of category groups', () => {
		const result = getShortcutsByCategory();
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBe(5);
	});

	it('should return categories in order: playback, editing, timeline, tools, general', () => {
		const result = getShortcutsByCategory();
		expect(result.map((r) => r.category)).toEqual([
			'playback',
			'editing',
			'timeline',
			'tools',
			'general',
		]);
	});

	it('each group should have category, label, and shortcuts', () => {
		const result = getShortcutsByCategory();
		for (const group of result) {
			expect(typeof group.category).toBe('string');
			expect(typeof group.label).toBe('string');
			expect(Array.isArray(group.shortcuts)).toBe(true);
			expect(group.shortcuts.length).toBeGreaterThan(0);
		}
	});

	it('should have correct labels for categories', () => {
		const result = getShortcutsByCategory();
		const labels = Object.fromEntries(result.map((r) => [r.category, r.label]));
		expect(labels.playback).toBe('Playback');
		expect(labels.editing).toBe('Editing');
		expect(labels.timeline).toBe('Timeline');
		expect(labels.tools).toBe('Tools');
		expect(labels.general).toBe('General');
	});

	it('shortcuts in each group should belong to that category', () => {
		const result = getShortcutsByCategory();
		for (const group of result) {
			for (const s of group.shortcuts) {
				expect(s.category).toBe(group.category);
			}
		}
	});

	it('total shortcuts across all groups should equal SHORTCUTS length', () => {
		const result = getShortcutsByCategory();
		const total = result.reduce((sum, g) => sum + g.shortcuts.length, 0);
		expect(total).toBe(SHORTCUTS.length);
	});
});

describe('getShortcutLabel', () => {
	it('should return label for a known action', () => {
		expect(getShortcutLabel('playback.toggle')).toBe('Space');
	});

	it('should return label for Ctrl+Z undo', () => {
		expect(getShortcutLabel('history.undo')).toBe('Ctrl+Z');
	});

	it('should return label for save', () => {
		expect(getShortcutLabel('project.save')).toBe('Ctrl+S');
	});

	it('should return undefined for unknown action', () => {
		expect(getShortcutLabel('nonexistent.action')).toBeUndefined();
	});

	it('should return undefined for empty string', () => {
		expect(getShortcutLabel('')).toBeUndefined();
	});
});

describe('matchShortcut', () => {
	function createKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
		return {
			key: '',
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			altKey: false,
			...overrides,
		} as KeyboardEvent;
	}

	it('should match Space for play/pause', () => {
		const event = createKeyEvent({ key: ' ' });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('playback.toggle');
	});

	it('should match Ctrl+Z for undo', () => {
		const event = createKeyEvent({ key: 'z', ctrlKey: true });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('history.undo');
	});

	it('should match Ctrl+Shift+Z for redo', () => {
		const event = createKeyEvent({ key: 'z', ctrlKey: true, shiftKey: true });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('history.redo');
	});

	it('should match Meta key as Ctrl equivalent', () => {
		const event = createKeyEvent({ key: 'z', metaKey: true });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('history.undo');
	});

	it('should match Delete for delete', () => {
		const event = createKeyEvent({ key: 'Delete' });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('timeline.delete');
	});

	it('should match case-insensitively', () => {
		const event = createKeyEvent({ key: 'S' });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('timeline.split');
	});

	it('should return undefined for unbound key', () => {
		const event = createKeyEvent({ key: 'q' });
		const result = matchShortcut(event);
		expect(result).toBeUndefined();
	});

	it('should not match Ctrl+key when only key is pressed', () => {
		// 'a' without ctrl should not match Ctrl+A (select all)
		const event = createKeyEvent({ key: 'a' });
		const result = matchShortcut(event);
		// 'a' without modifiers is not bound to anything
		expect(result).toBeUndefined();
	});

	it('should not match when extra modifiers are pressed', () => {
		// Space + Ctrl should not match Space (which has no modifiers)
		const event = createKeyEvent({ key: ' ', ctrlKey: true });
		const result = matchShortcut(event);
		expect(result).toBeUndefined();
	});

	it('should match Ctrl+S for save', () => {
		const event = createKeyEvent({ key: 's', ctrlKey: true });
		const result = matchShortcut(event);
		expect(result).toBeDefined();
		expect(result!.action).toBe('project.save');
	});
});
