import { isDesktop } from './env.js';

/**
 * Getting the app out of the way while it records.
 *
 * During a recording the editor renders nothing but the floating controls, so
 * a full-size window is a large black rectangle sitting over the screen — and
 * since it is still on screen, the recording captures it. The window shrinks to
 * a control bar for the duration and goes back afterwards, which is what every
 * desktop recorder does.
 *
 * Everything here is best-effort. Failing to resize a window must never stop a
 * recording, so each step is guarded and the worst case is the behaviour that
 * shipped before.
 */

const BAR_WIDTH = 360;
const BAR_HEIGHT = 92;
/** Clear of the taskbar, and clear of whatever the user is demonstrating. */
const BOTTOM_MARGIN = 96;

interface RestoreState {
	width: number;
	height: number;
	x: number;
	y: number;
	maximized: boolean;
	decorated: boolean;
	alwaysOnTop: boolean;
}

let saved: RestoreState | null = null;

/** Shrinks the window to a floating control bar. */
export async function enterRecordingChrome(): Promise<void> {
	if (!isDesktop()) return;

	try {
		const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
		const win = getCurrentWindow();

		const scale = await win.scaleFactor();
		const size = (await win.outerSize()).toLogical(scale);
		const position = (await win.outerPosition()).toLogical(scale);
		const maximized = await win.isMaximized();

		saved = {
			width: size.width,
			height: size.height,
			x: position.x,
			y: position.y,
			maximized,
			decorated: true,
			alwaysOnTop: false,
		};

		// Unmaximise first: a maximised window ignores a resize on most window
		// managers, which would leave the black rectangle exactly where it was.
		if (maximized) await win.unmaximize();

		await win.setDecorations(false);
		await win.setAlwaysOnTop(true);
		await win.setSize(new LogicalSize(BAR_WIDTH, BAR_HEIGHT));

		const screen = await screenSize(win, scale);
		await win.setPosition(
			new LogicalPosition(
				Math.max(0, Math.round((screen.width - BAR_WIDTH) / 2)),
				Math.max(0, Math.round(screen.height - BAR_HEIGHT - BOTTOM_MARGIN))
			)
		);
	} catch (error) {
		console.warn('[recorder] could not shrink the window:', error);
	}
}

/** Puts the window back the way the user had it. */
export async function exitRecordingChrome(): Promise<void> {
	if (!isDesktop() || !saved) return;

	const previous = saved;
	saved = null;

	try {
		const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
		const win = getCurrentWindow();

		await win.setAlwaysOnTop(previous.alwaysOnTop);
		await win.setDecorations(previous.decorated);

		if (previous.maximized) {
			await win.maximize();
		} else {
			await win.setSize(new LogicalSize(previous.width, previous.height));
			await win.setPosition(new LogicalPosition(previous.x, previous.y));
		}
		await win.setFocus();
	} catch (error) {
		console.warn('[recorder] could not restore the window:', error);
	}
}

/**
 * Usable screen size.
 *
 * `window.screen` is the webview's view of the display, which is what the bar
 * has to be positioned within; querying the monitor through Tauri would need a
 * further permission for no practical gain.
 */
async function screenSize(
	_win: unknown,
	_scale: number
): Promise<{ width: number; height: number }> {
	return {
		width: window.screen?.width ?? 1920,
		height: window.screen?.height ?? 1080,
	};
}
