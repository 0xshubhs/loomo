import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosave } from './autosave.js';

/**
 * Autosave exists for the session that ends without warning. Everything here
 * is about it firing when it should and staying out of the way when it
 * shouldn't.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function harness(over: { canSave?: () => boolean } = {}) {
	const save = vi.fn(async () => true);
	const autosave = createAutosave({
		delayMs: 1000,
		save,
		canSave: over.canSave ?? (() => true),
	});
	return { autosave, save };
}

describe('autosave timing', () => {
	it('writes once the delay has passed', async () => {
		const { autosave, save } = harness();

		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);

		expect(save).toHaveBeenCalledTimes(1);
	});

	it('does not write before the delay', async () => {
		const { autosave, save } = harness();

		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(999);

		expect(save).not.toHaveBeenCalled();
	});

	it('still fires while the user keeps editing', async () => {
		// The whole point. A debounce would reset on every keystroke and never
		// save during exactly the long session autosave is for.
		const { autosave, save } = harness();

		for (let elapsed = 0; elapsed < 900; elapsed += 100) {
			autosave.noteChange();
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(save).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(100);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('arms again after a save, for the next round of changes', async () => {
		const { autosave, save } = harness();

		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);
		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);

		expect(save).toHaveBeenCalledTimes(2);
	});

	it('does nothing when there was no change', async () => {
		const { autosave, save } = harness();

		await vi.advanceTimersByTimeAsync(10_000);

		expect(save).not.toHaveBeenCalled();
	});
});

describe('staying out of the way', () => {
	it('does not save a project that is not worth saving', async () => {
		// An empty editor would otherwise leave a project behind every time
		// someone opened it and changed their mind.
		const { autosave, save } = harness({ canSave: () => false });

		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);

		expect(save).not.toHaveBeenCalled();
	});

	it('re-checks at fire time, not just when armed', async () => {
		// An export may have started, or the user may have hit Ctrl+S, in the
		// seconds between arming and firing.
		let allowed = true;
		const save = vi.fn(async () => true);
		const autosave = createAutosave({ delayMs: 1000, save, canSave: () => allowed });

		autosave.noteChange();
		allowed = false;
		await vi.advanceTimersByTimeAsync(1000);

		expect(save).not.toHaveBeenCalled();
	});

	it('does not start a second write while one is still running', async () => {
		let release: (v: boolean) => void = () => {};
		const save = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
		const autosave = createAutosave({ delayMs: 1000, save, canSave: () => true });

		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);
		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);

		expect(save).toHaveBeenCalledTimes(1);
		release(true);
	});

	it('survives a failing save without throwing at the editor', async () => {
		const save = vi.fn(async () => { throw new Error('disk full'); });
		const autosave = createAutosave({ delayMs: 1000, save, canSave: () => true });

		autosave.noteChange();
		await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
	});

	it('arms again after a failure, so a transient error is not permanent', async () => {
		let failing = true;
		const save = vi.fn(async () => {
			if (failing) throw new Error('busy');
			return true;
		});
		const autosave = createAutosave({ delayMs: 1000, save, canSave: () => true });

		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);
		failing = false;
		autosave.noteChange();
		await vi.advanceTimersByTimeAsync(1000);

		expect(save).toHaveBeenCalledTimes(2);
	});
});

describe('cancel and flush', () => {
	it('cancel drops a pending write', async () => {
		const { autosave, save } = harness();

		autosave.noteChange();
		autosave.cancel();
		await vi.advanceTimersByTimeAsync(10_000);

		expect(save).not.toHaveBeenCalled();
	});

	it('flush writes immediately', async () => {
		const { autosave, save } = harness();

		autosave.noteChange();
		await autosave.flush();

		expect(save).toHaveBeenCalledTimes(1);
	});

	it('flush does not write a second time later', async () => {
		const { autosave, save } = harness();

		autosave.noteChange();
		await autosave.flush();
		await vi.advanceTimersByTimeAsync(10_000);

		expect(save).toHaveBeenCalledTimes(1);
	});

	it('reports whether a write is armed', () => {
		const { autosave } = harness();

		expect(autosave.pending).toBe(false);
		autosave.noteChange();
		expect(autosave.pending).toBe(true);
		autosave.cancel();
		expect(autosave.pending).toBe(false);
	});
});
