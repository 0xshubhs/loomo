/**
 * The only place in the app that knows onnxruntime-web exists.
 *
 * The runtime is deliberately *not* a dependency in package.json yet: it drags
 * in ~30 MB of wasm/webgpu artefacts and we are still deciding whether to ship
 * it. So the import below is written against a variable specifier, which stops
 * both TypeScript and Vite from resolving it at build time. Nothing else in
 * `$lib/ai` imports onnxruntime — everything talks to the small interfaces
 * declared here, which means tests can hand the tools a fake session and the
 * whole tensor pipeline runs with no network, no wasm and no model file.
 *
 * To actually run inference, add `onnxruntime-web` to package.json. No code in
 * this directory changes.
 */

/** Only float32 is used — every model in the registry takes and returns it. */
export type AiTensorType = 'float32';

/** Mirrors `ort.Tensor` closely enough that real tensors satisfy it as-is. */
export interface AiTensor {
	readonly type: AiTensorType;
	readonly data: Float32Array;
	readonly dims: readonly number[];
}

/** Mirrors `ort.InferenceSession`, minus everything we never call. */
export interface AiSession {
	readonly inputNames: readonly string[];
	readonly outputNames: readonly string[];
	run(feeds: Record<string, AiTensor>): Promise<Record<string, AiTensor>>;
	release(): Promise<void>;
}

export interface AiRuntime {
	/** Which execution provider actually got selected, for the UI to report. */
	readonly backend: 'webgpu' | 'wasm';
	createSession(model: Uint8Array): Promise<AiSession>;
	createTensor(data: Float32Array, dims: readonly number[]): AiTensor;
}

/** Loader shape, so tests and future backends can substitute the whole runtime. */
export type AiRuntimeLoader = () => Promise<AiRuntime>;

export type AiUnavailableReason =
	| 'not-installed'
	| 'no-backend'
	| 'server-side'
	| 'load-failed';

/**
 * Thrown whenever inference cannot happen at all, as opposed to failing.
 * Carries a reason so the panel can say something better than "error".
 */
export class AiUnavailableError extends Error {
	readonly reason: AiUnavailableReason;

	constructor(reason: AiUnavailableReason, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'AiUnavailableError';
		this.reason = reason;
	}
}

/** Raised when a model runs but produces something the tool cannot use. */
export class AiToolError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'AiToolError';
	}
}

/**
 * Whether a runtime could plausibly start here.
 *
 * Cheap and synchronous so the UI can gate its controls before anything is
 * downloaded — a user on a browser without WebAssembly should never be offered
 * a 176 MB download that cannot possibly run.
 */
export function isRuntimeSupported(): boolean {
	if (typeof window === 'undefined') return false;
	return typeof WebAssembly !== 'undefined';
}

/** WebGPU is an order of magnitude faster; wasm is the universal fallback. */
export function preferredBackend(): 'webgpu' | 'wasm' {
	const hasWebGpu =
		typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;
	return hasWebGpu ? 'webgpu' : 'wasm';
}

let loader: AiRuntimeLoader = loadOnnxRuntimeWeb;
let pending: Promise<AiRuntime> | null = null;

/**
 * Swaps the runtime out. Tests inject a fake; a future native backend (ORT
 * through Tauri) can be plugged in the same way. Passing null restores the
 * onnxruntime-web loader.
 */
export function setAiRuntimeLoader(next: AiRuntimeLoader | null): void {
	loader = next ?? loadOnnxRuntimeWeb;
	pending = null;
}

/**
 * Resolves the shared runtime, loading it at most once.
 *
 * A failed load clears the memo rather than caching the rejection, because the
 * usual cause is a transient chunk-fetch failure and the user's next click
 * should get a real second attempt.
 */
export function loadAiRuntime(): Promise<AiRuntime> {
	if (pending) return pending;
	pending = loader().catch((error) => {
		pending = null;
		throw error;
	});
	return pending;
}

/** Drops the memoised runtime. Used by tests; harmless elsewhere. */
export function resetAiRuntime(): void {
	pending = null;
}

/**
 * Bridges the real onnxruntime-web API onto the interfaces above.
 *
 * Feeds are rebuilt into genuine `ort.Tensor` instances instead of being passed
 * through, because callers construct plain objects and ORT checks prototypes.
 */
async function loadOnnxRuntimeWeb(): Promise<AiRuntime> {
	if (typeof window === 'undefined') {
		throw new AiUnavailableError('server-side', 'AI tools only run in the browser.');
	}
	if (!isRuntimeSupported()) {
		throw new AiUnavailableError(
			'no-backend',
			'This browser has no WebAssembly support, so on-device AI cannot run.'
		);
	}

	// A variable specifier keeps the module unresolved at build time; see the
	// file header for why onnxruntime-web is not a dependency yet.
	const specifier = 'onnxruntime-web';
	let ort: any;
	try {
		ort = await import(/* @vite-ignore */ specifier);
	} catch (error) {
		throw new AiUnavailableError(
			'not-installed',
			'The AI runtime is not installed in this build. Add "onnxruntime-web" to apps/web/package.json to enable on-device AI.',
			{ cause: error }
		);
	}

	const backend = preferredBackend();

	return {
		backend,
		createTensor(data, dims) {
			return new ort.Tensor('float32', data, [...dims]) as AiTensor;
		},
		async createSession(model) {
			let native: any;
			try {
				native = await ort.InferenceSession.create(model, {
					// wasm is always listed second so a WebGPU adapter that fails to
					// initialise degrades to a slow run instead of a hard failure.
					executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
					graphOptimizationLevel: 'all',
				});
			} catch (error) {
				throw new AiUnavailableError('load-failed', 'The model failed to load into the AI runtime.', {
					cause: error,
				});
			}
			return wrapSession(ort, native);
		},
	};
}

function wrapSession(ort: any, native: any): AiSession {
	return {
		inputNames: native.inputNames ?? [],
		outputNames: native.outputNames ?? [],
		async run(feeds) {
			const nativeFeeds: Record<string, unknown> = {};
			for (const [name, tensor] of Object.entries(feeds)) {
				nativeFeeds[name] = new ort.Tensor('float32', tensor.data, [...tensor.dims]);
			}
			const raw = await native.run(nativeFeeds);
			const out: Record<string, AiTensor> = {};
			for (const [name, tensor] of Object.entries<any>(raw)) {
				out[name] = {
					type: 'float32',
					// Quantised models can hand back uint8/int64 views; widening here
					// keeps every postprocessing routine on one numeric type.
					data:
						tensor.data instanceof Float32Array
							? tensor.data
							: Float32Array.from(tensor.data as ArrayLike<number>),
					dims: tensor.dims as number[],
				};
			}
			return out;
		},
		async release() {
			await native.release?.();
		},
	};
}

/**
 * Picks the feed key to use. Re-exports of the same architecture rename their
 * input freely ("input", "input.1", "img"), so trusting the session over the
 * registry avoids a re-release every time an upstream export changes.
 */
export function resolveInputName(session: AiSession, preferredName: string): string {
	const names = session.inputNames;
	if (names.length === 0 || names.includes(preferredName)) return preferredName;
	if (names.length === 1) return names[0];
	throw new AiToolError(
		`The model has no input named "${preferredName}" (found: ${names.join(', ')}).`
	);
}

/**
 * Pulls the named output, falling back to the sole output when the graph uses
 * a different name than the registry records. Model exports rename outputs far
 * more often than they change shape, so this is worth tolerating.
 */
export function selectOutput(
	outputs: Record<string, AiTensor>,
	preferredName: string
): AiTensor {
	const named = outputs[preferredName];
	if (named) return named;

	const values = Object.values(outputs);
	if (values.length === 0) throw new AiToolError('The model returned no outputs.');
	if (values.length === 1) return values[0];

	throw new AiToolError(
		`The model has no output named "${preferredName}" (found: ${Object.keys(outputs).join(', ')}).`
	);
}
