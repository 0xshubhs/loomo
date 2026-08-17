import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './env.js';

/**
 * Routes frontend diagnostics somewhere a terminal can actually see them.
 *
 * WebKitGTK runs page content in a separate process and does not forward
 * `console.*` to the host's stderr — verified: a page logging a marker string
 * produces zero output from the hosting process. So on the desktop every
 * console call and every uncaught error is mirrored through a Tauri command,
 * which prints to stderr and appends to a log file.
 *
 * Without this, a failure in the UI is completely invisible from outside the
 * window, which is exactly how an import that silently did nothing stayed
 * unexplained through several rebuilds.
 */

let installed = false;

function send(level: string, parts: unknown[]): void {
	const line = parts
		.map((p) => {
			if (typeof p === 'string') return p;
			if (p instanceof Error) return `${p.name}: ${p.message}\n${p.stack ?? ''}`;
			try {
				return JSON.stringify(p);
			} catch {
				return String(p);
			}
		})
		.join(' ');

	// Fire and forget: diagnostics must never become a failure of their own.
	void invoke('diag_log', { line: `${level} ${line}` }).catch(() => {});
}

export function installDiagnostics(): void {
	if (installed || !isDesktop()) return;
	installed = true;

	for (const level of ['log', 'info', 'warn', 'error'] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			original(...args);
			send(level.toUpperCase(), args);
		};
	}

	window.addEventListener('error', (event) => {
		send('UNCAUGHT', [
			`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
			event.error instanceof Error ? event.error : '',
		]);
	});

	window.addEventListener('unhandledrejection', (event) => {
		send('UNHANDLED-REJECTION', [event.reason]);
	});

	send('BOOT', [
		`loomo ui started — ${navigator.userAgent}`,
	]);
}

/** Where the log is written, for showing the user. */
export async function diagnosticsPath(): Promise<string | null> {
	if (!isDesktop()) return null;
	try {
		return await invoke<string>('diag_log_path');
	} catch {
		return null;
	}
}
