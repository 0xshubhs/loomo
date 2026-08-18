import { describe, it, expect, afterEach } from 'vitest';
import {
	AiToolError,
	AiUnavailableError,
	isRuntimeSupported,
	loadAiRuntime,
	preferredBackend,
	resetAiRuntime,
	resolveInputName,
	selectOutput,
	setAiRuntimeLoader,
	type AiRuntime,
	type AiSession,
	type AiTensor,
} from './runtime.js';

function fakeSession(overrides: Partial<AiSession> = {}): AiSession {
	return {
		inputNames: ['input'],
		outputNames: ['output'],
		run: async () => ({}),
		release: async () => {},
		...overrides,
	};
}

function tensor(value: number): AiTensor {
	return { type: 'float32', data: new Float32Array([value]), dims: [1, 1, 1, 1] };
}

afterEach(() => {
	setAiRuntimeLoader(null);
	resetAiRuntime();
});

describe('isRuntimeSupported', () => {
	it('should be false under Node, where there is no window', () => {
		expect(isRuntimeSupported()).toBe(false);
	});
});

describe('preferredBackend', () => {
	it('should fall back to wasm without a WebGPU adapter', () => {
		expect(preferredBackend()).toBe('wasm');
	});
});

describe('loadAiRuntime', () => {
	it('should reject with AiUnavailableError when onnxruntime-web is absent', async () => {
		const error = await loadAiRuntime().catch((e) => e);
		expect(error).toBeInstanceOf(AiUnavailableError);
		// Node has no window, so this is the server-side branch rather than a crash.
		expect((error as AiUnavailableError).reason).toBe('server-side');
	});

	it('should use an injected loader', async () => {
		const runtime = { backend: 'wasm' } as AiRuntime;
		setAiRuntimeLoader(async () => runtime);
		expect(await loadAiRuntime()).toBe(runtime);
	});

	it('should load the runtime only once', async () => {
		let calls = 0;
		setAiRuntimeLoader(async () => {
			calls++;
			return { backend: 'wasm' } as AiRuntime;
		});
		await loadAiRuntime();
		await loadAiRuntime();
		expect(calls).toBe(1);
	});

	it('should retry after a failure instead of caching the rejection', async () => {
		let calls = 0;
		setAiRuntimeLoader(async () => {
			calls++;
			if (calls === 1) throw new Error('chunk load failed');
			return { backend: 'wasm' } as AiRuntime;
		});

		await expect(loadAiRuntime()).rejects.toThrow('chunk load failed');
		await expect(loadAiRuntime()).resolves.toBeDefined();
		expect(calls).toBe(2);
	});
});

describe('resolveInputName', () => {
	it('should use the preferred name when the session has it', () => {
		expect(resolveInputName(fakeSession({ inputNames: ['input', 'mask'] }), 'input')).toBe('input');
	});

	it('should fall back to the only input when the name differs', () => {
		expect(resolveInputName(fakeSession({ inputNames: ['input.1'] }), 'input')).toBe('input.1');
	});

	it('should trust the caller when the session reports no inputs', () => {
		expect(resolveInputName(fakeSession({ inputNames: [] }), 'input')).toBe('input');
	});

	it('should throw when the name is ambiguous', () => {
		expect(() => resolveInputName(fakeSession({ inputNames: ['a', 'b'] }), 'input')).toThrow(
			AiToolError
		);
	});
});

describe('selectOutput', () => {
	it('should return the named output', () => {
		const chosen = tensor(2);
		expect(selectOutput({ other: tensor(1), output: chosen }, 'output')).toBe(chosen);
	});

	it('should fall back to a sole differently-named output', () => {
		const only = tensor(5);
		expect(selectOutput({ '1959': only }, 'output')).toBe(only);
	});

	it('should throw when the model returned nothing', () => {
		expect(() => selectOutput({}, 'output')).toThrow(AiToolError);
	});

	it('should throw rather than guess between several outputs', () => {
		expect(() => selectOutput({ a: tensor(1), b: tensor(2) }, 'output')).toThrow(/no output named/);
	});
});
