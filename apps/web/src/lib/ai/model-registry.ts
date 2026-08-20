/**
 * Every ONNX model the AI tools can use, and the numbers each one needs.
 *
 * Models are never bundled. They are hundreds of megabytes and most people
 * will use none of them, so the app ships the metadata only and fetches the
 * weights the first time somebody asks for a tool. Everything the download and
 * the tensor code need — URL, digest, size, tensor names, normalisation — is
 * declared here so no other module hard-codes a magic number.
 */

export type ModelPurpose = 'background-removal' | 'upscale' | 'colorize';

/** One side of the graph: its tensor name and the shape it expects/produces. */
export interface ModelIo {
	readonly name: string;
	readonly width: number;
	readonly height: number;
	readonly channels: number;
}

export interface ModelSpec {
	readonly id: string;
	readonly name: string;
	readonly purpose: ModelPurpose;
	readonly url: string;
	/**
	 * Lowercase hex SHA-256 of the file at `url`.
	 *
	 * `null` means we have not pinned a digest for this artefact yet. The
	 * download still works, but `ModelCache` reports `verified: false` and the
	 * UI says so — a null here is a known gap, not a silent one. Pin these
	 * (`sha256sum` on the downloaded file) before shipping to real users.
	 */
	readonly sha256: string | null;
	/** Download size in bytes. Shown to the user *before* they commit to it. */
	readonly bytes: number;
	readonly licence: string;
	readonly licenceUrl: string;
	/** False when the licence bars commercial use — surfaced in the UI. */
	readonly commercialUse: boolean;
	readonly input: ModelIo;
	readonly output: ModelIo;
	/** Per-channel mean applied after pixels are scaled to 0-1. */
	readonly mean: readonly [number, number, number];
	/** Per-channel standard deviation applied after the mean is subtracted. */
	readonly std: readonly [number, number, number];
	/** Resolution multiplier. 1 for anything that is not an upscaler. */
	readonly scale: number;
	/** Rough single-frame latency on the wasm backend, in milliseconds. */
	readonly wasmFrameMs: number;
	/** One recommended model per purpose, used as the default selection. */
	readonly recommended: boolean;
	readonly summary: string;
	/**
	 * Whether the weights can actually be fetched.
	 *
	 * Two entries here point at repositories that no longer exist and answer
	 * 401 — checked, not assumed. They are kept rather than deleted because the
	 * preprocessing they describe is real and tested, and because a spec is
	 * what a replacement URL slots into. `modelsForPurpose` hides them, so the
	 * UI never offers a download that cannot succeed.
	 */
	readonly available?: boolean;
}

/**
 * URLs point at upstream release artefacts rather than a CDN we control, so a
 * publisher retagging a release can move the bytes under us — which is exactly
 * why `sha256` exists and why these must be pinned before release.
 */
export const AI_MODELS: readonly ModelSpec[] = [
	{
		id: 'u2netp',
		name: 'U²-Net Lite',
		purpose: 'background-removal',
		url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
		// Hashed from the actual download, not copied from a README.
		sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
		bytes: 4_574_861,
		licence: 'Apache-2.0',
		licenceUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE',
		commercialUse: true,
		input: { name: 'input.1', width: 320, height: 320, channels: 3 },
		output: { name: '1959', width: 320, height: 320, channels: 1 },
		// U²-Net normalises with the ImageNet statistics its encoder was trained on.
		mean: [0.485, 0.456, 0.406],
		std: [0.229, 0.224, 0.225],
		scale: 1,
		wasmFrameMs: 320,
		recommended: true,
		summary: 'Small and fast. Good on clear subjects, softer around hair and fine edges.',
	},
	{
		id: 'u2net',
		name: 'U²-Net Full',
		purpose: 'background-removal',
		url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx',
		sha256: null,
		bytes: 176_268_465,
		licence: 'Apache-2.0',
		licenceUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE',
		commercialUse: true,
		input: { name: 'input.1', width: 320, height: 320, channels: 3 },
		output: { name: '1959', width: 320, height: 320, channels: 1 },
		mean: [0.485, 0.456, 0.406],
		std: [0.229, 0.224, 0.225],
		scale: 1,
		wasmFrameMs: 1500,
		recommended: false,
		summary: 'Much cleaner edges than the Lite model, at roughly five times the cost.',
	},
	{
		id: 'rmbg-1.4',
		name: 'RMBG 1.4',
		purpose: 'background-removal',
		url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
		// Hugging Face publishes the LFS digest as X-Linked-Etag; this is it.
		sha256: '8cafcf770b06757c4eaced21b1a88e57fd2b66de01b8045f35f01535ba742e0f',
		bytes: 176_153_355,
		licence: 'bria-rmbg-1.4 (non-commercial)',
		licenceUrl: 'https://huggingface.co/briaai/RMBG-1.4',
		commercialUse: false,
		input: { name: 'input', width: 1024, height: 1024, channels: 3 },
		output: { name: 'output', width: 1024, height: 1024, channels: 1 },
		// RMBG scales to 0-1 then centres on 0.5 rather than ImageNet stats.
		mean: [0.5, 0.5, 0.5],
		std: [1.0, 1.0, 1.0],
		scale: 1,
		wasmFrameMs: 4200,
		recommended: false,
		summary: 'Best quality of the three. Its licence forbids commercial use.',
	},
	{
		id: 'realesrgan-x2plus',
		name: 'Real-ESRGAN x2',
		purpose: 'upscale',
		// This repository answers 401; no working x2 ONNX was found to replace
		// it. The x4 model below is live and covers the purpose.
		available: false,
		url: 'https://huggingface.co/Xenova/real-esrgan-x2plus/resolve/main/onnx/model.onnx',
		sha256: null,
		bytes: 67_166_112,
		licence: 'BSD-3-Clause',
		licenceUrl: 'https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE',
		commercialUse: true,
		input: { name: 'input', width: 256, height: 256, channels: 3 },
		output: { name: 'output', width: 512, height: 512, channels: 3 },
		// Real-ESRGAN takes plain 0-1 RGB; an identity normalisation keeps the
		// preprocessing path the same for every model.
		mean: [0, 0, 0],
		std: [1, 1, 1],
		scale: 2,
		wasmFrameMs: 2600,
		recommended: false,
		summary: 'Doubles resolution. Runs tiled, so memory stays flat on large frames.',
	},
	{
		id: 'realesrgan-x4plus',
		name: 'Real-ESRGAN x4',
		purpose: 'upscale',
		// The Xenova repo this used to point at does not exist and answers 401.
		// This one was checked live and its digest read from the LFS metadata.
		url: 'https://huggingface.co/imgdesignart/realesrgan-x4-onnx/resolve/main/onnx/model.onnx',
		sha256: 'fa18ce70de3a55f3149d0cc898d335d2d69fca29edc0692cb362c856b2942c3f',
		bytes: 67_051_787,
		licence: 'BSD-3-Clause',
		licenceUrl: 'https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE',
		commercialUse: true,
		input: { name: 'input', width: 256, height: 256, channels: 3 },
		output: { name: 'output', width: 1024, height: 1024, channels: 3 },
		mean: [0, 0, 0],
		std: [1, 1, 1],
		scale: 4,
		wasmFrameMs: 5200,
		// The only upscale model with weights that can actually be fetched.
		recommended: true,
		summary: 'Quadruples resolution. Slow, and invents detail on already-sharp footage.',
	},
	{
		id: 'siggraph17-colorize',
		name: 'Colorization (SIGGRAPH 17)',
		purpose: 'colorize',
		// This repository answers 401. The only ONNX colorizer found on the hub
		// is manga-specific, which is not what this tool is for, so colorize
		// has no working model at all.
		available: false,
		url: 'https://huggingface.co/Xenova/colorizer-siggraph17/resolve/main/onnx/model.onnx',
		sha256: null,
		bytes: 129_247_232,
		licence: 'BSD-2-Clause',
		licenceUrl: 'https://github.com/richzhang/colorization/blob/master/LICENSE',
		commercialUse: true,
		// The network sees lightness only and predicts the two chroma channels,
		// which is why the input has one channel and the output has two.
		input: { name: 'input', width: 256, height: 256, channels: 1 },
		output: { name: 'output', width: 256, height: 256, channels: 2 },
		// Lightness is centred by subtracting 50 in Lab space, not in 0-1 RGB
		// space, so these RGB statistics are unused for this model.
		mean: [0, 0, 0],
		std: [1, 1, 1],
		scale: 1,
		wasmFrameMs: 1800,
		recommended: true,
		summary: 'Colours black-and-white footage. Plausible rather than accurate.',
	},
];

export function getModelSpec(id: string): ModelSpec | null {
	return AI_MODELS.find((model) => model.id === id) ?? null;
}

export function modelsForPurpose(purpose: ModelPurpose): ModelSpec[] {
	return AI_MODELS.filter((model) => model.purpose === purpose && model.available !== false);
}

/** Every registered model, including ones whose weights cannot be fetched. */
export function allModelsForPurpose(purpose: ModelPurpose): ModelSpec[] {
	return AI_MODELS.filter((model) => model.purpose === purpose);
}

/** The model a tool reaches for when the user has not chosen one. */
export function defaultModelForPurpose(purpose: ModelPurpose): ModelSpec {
	const candidates = modelsForPurpose(purpose);
	const recommended = candidates.find((model) => model.recommended);
	if (!recommended) throw new Error(`No recommended model registered for "${purpose}"`);
	return recommended;
}

/** Download sizes, in the units a person actually reads. */
export function formatModelSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	const mb = bytes / (1024 * 1024);
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * How long running this model over a stretch of video would take, in seconds.
 *
 * Exists so the UI can put a real number in front of someone before they ask
 * for something that takes twenty minutes. Wildly approximate — it uses the
 * wasm figure, and WebGPU is several times faster.
 */
export function estimateFrameBudgetSeconds(spec: ModelSpec, frameCount: number): number {
	return (spec.wasmFrameMs * Math.max(0, frameCount)) / 1000;
}

/** "about 4 minutes" — vague on purpose, because the estimate is. */
export function formatDurationEstimate(seconds: number): string {
	if (seconds < 1) return 'under a second';
	if (seconds < 90) return `about ${Math.round(seconds)} seconds`;
	if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
	return `about ${(seconds / 3600).toFixed(1)} hours`;
}
