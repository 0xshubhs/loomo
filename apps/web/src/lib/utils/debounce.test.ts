import { describe, it, expect, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
	it('calls the function after the delay', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	it('resets the timer on subsequent calls', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		vi.advanceTimersByTime(50);
		debounced();
		vi.advanceTimersByTime(50);
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	it('passes arguments to the original function', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced('a', 'b');
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledWith('a', 'b');
		vi.useRealTimers();
	});
});
