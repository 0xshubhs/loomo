import { setContext, getContext } from 'svelte';
import { ProjectStore } from './project.svelte.js';
import { TimelineStore } from './timeline.svelte.js';
import { MediaLibraryStore } from './media-library.svelte.js';
import { PlaybackStore } from './playback.svelte.js';
import { UIStore } from './ui.svelte.js';
import { SelectionStore } from './selection.svelte.js';
import { CommandManager } from '$lib/commands/command-manager.svelte.js';
import { AuthStore } from './auth.svelte.js';
import { RecorderStore } from './recorder.svelte.js';
import { DashboardStore } from './dashboard.svelte.js';

const KEYS = {
	project: Symbol('project'),
	timeline: Symbol('timeline'),
	mediaLibrary: Symbol('mediaLibrary'),
	playback: Symbol('playback'),
	ui: Symbol('ui'),
	selection: Symbol('selection'),
	commands: Symbol('commands'),
	auth: Symbol('auth'),
	recorder: Symbol('recorder'),
	dashboard: Symbol('dashboard'),
} as const;

export interface EditorContext {
	project: ProjectStore;
	timeline: TimelineStore;
	mediaLibrary: MediaLibraryStore;
	playback: PlaybackStore;
	ui: UIStore;
	selection: SelectionStore;
	commands: CommandManager;
}

export function createEditorContext(): EditorContext {
	const project = new ProjectStore();
	const timeline = new TimelineStore();
	const mediaLibrary = new MediaLibraryStore();
	const playback = new PlaybackStore();
	const ui = new UIStore();
	const selection = new SelectionStore();
	const commands = new CommandManager();

	setContext(KEYS.project, project);
	setContext(KEYS.timeline, timeline);
	setContext(KEYS.mediaLibrary, mediaLibrary);
	setContext(KEYS.playback, playback);
	setContext(KEYS.ui, ui);
	setContext(KEYS.selection, selection);
	setContext(KEYS.commands, commands);

	return { project, timeline, mediaLibrary, playback, ui, selection, commands };
}

export function getProject(): ProjectStore {
	return getContext(KEYS.project);
}
export function getTimeline(): TimelineStore {
	return getContext(KEYS.timeline);
}
export function getMediaLibrary(): MediaLibraryStore {
	return getContext(KEYS.mediaLibrary);
}
export function getPlayback(): PlaybackStore {
	return getContext(KEYS.playback);
}
export function getUI(): UIStore {
	return getContext(KEYS.ui);
}
export function getSelection(): SelectionStore {
	return getContext(KEYS.selection);
}
export function getCommands(): CommandManager {
	return getContext(KEYS.commands);
}

export interface AppContext {
	auth: AuthStore;
	recorder: RecorderStore;
	dashboard: DashboardStore;
}

export function createAppContext(): AppContext {
	const auth = new AuthStore();
	const recorder = new RecorderStore();
	const dashboard = new DashboardStore();

	setContext(KEYS.auth, auth);
	setContext(KEYS.recorder, recorder);
	setContext(KEYS.dashboard, dashboard);

	return { auth, recorder, dashboard };
}

export function getAuth(): AuthStore {
	return getContext(KEYS.auth);
}
export function getRecorder(): RecorderStore {
	return getContext(KEYS.recorder);
}
export function getDashboard(): DashboardStore {
	return getContext(KEYS.dashboard);
}
