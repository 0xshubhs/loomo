/**
 * Whether we are running inside the Tauri desktop shell.
 *
 * Tauri v2 injects `__TAURI_INTERNALS__` into the webview before any app code
 * runs, so this is reliable from the first line — but it is only ever true in
 * the browser, never during SSR.
 */
export function isDesktop(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type DesktopPlatform = 'linux' | 'macos' | 'windows' | 'web';

let cachedPlatform: DesktopPlatform | null = null;

/** Coarse platform check for UI affordances (shortcut hints, window chrome). */
export function desktopPlatform(): DesktopPlatform {
	if (cachedPlatform) return cachedPlatform;
	if (!isDesktop()) return (cachedPlatform = 'web');

	const agent = navigator.userAgent;
	if (agent.includes('Mac')) cachedPlatform = 'macos';
	else if (agent.includes('Windows')) cachedPlatform = 'windows';
	else cachedPlatform = 'linux';

	return cachedPlatform;
}
