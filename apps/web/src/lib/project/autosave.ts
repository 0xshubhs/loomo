/**
 * Autosave.
 *
 * The editor asks before you leave, but that only covers leaving. A crash, a
 * power cut or a killed process took the whole session with it, which for an
 * hour of editing is not a reasonable thing to lose.
 *
 * This throttles rather than debounces: the timer is armed by the *first*
 * unsaved change and is not pushed back by later ones. Debouncing sounds
 * right and is wrong here — someone editing continuously for twenty minutes
 * would never reach a quiet moment, so the one case autosave exists for is
 * the one case it would never fire in.
 */

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AutosaveOptions {
	/** How long after the first unsaved change to write. */
	delayMs: number;
	/** Performs the save. Resolves false if it failed. */
	save: () => Promise<boolean>;
	/**
	 * Whether saving is worth doing right now.
	 *
	 * Guards the two cases that would do harm: an untouched new project, which
	 * would litter the library with empty entries every time someone opened
	 * the editor and backed out, and a save already in flight.
	 */
	canSave: () => boolean;
	setTimer?: (fn: () => void, ms: number) => TimerHandle;
	clearTimer?: (handle: TimerHandle) => void;
}

export interface Autosave {
	/** Called whenever the project becomes dirty. Cheap to call repeatedly. */
	noteChange(): void;
	/** Saves now if there is anything pending. */
	flush(): Promise<void>;
	/** Drops any pending save. Called when the editor is torn down. */
	cancel(): void;
	/** True while a write is armed. Exposed for tests and the status bar. */
	readonly pending: boolean;
}

export function createAutosave(options: AutosaveOptions): Autosave {
	const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as TimerHandle);
	const clearTimer = options.clearTimer ?? ((handle: TimerHandle) => clearTimeout(handle));

	let handle: TimerHandle | null = null;
	let running = false;

	async function run() {
		handle = null;
		// Re-checked at fire time, not just when armed: the project may have
		// been saved by hand, or an export may have started, in the seconds
		// since.
		if (running || !options.canSave()) return;

		running = true;
		try {
			await options.save();
		} catch (error) {
			// A failed autosave is not the user's problem to be interrupted
			// over — they did not ask for it. The next change arms it again.
			console.warn('[autosave] failed:', error);
		} finally {
			running = false;
		}
	}

	return {
		noteChange() {
			if (handle !== null) return;
			handle = setTimer(() => void run(), options.delayMs);
		},

		async flush() {
			if (handle !== null) {
				clearTimer(handle);
				handle = null;
			}
			await run();
		},

		cancel() {
			if (handle !== null) {
				clearTimer(handle);
				handle = null;
			}
		},

		get pending() {
			return handle !== null;
		},
	};
}
