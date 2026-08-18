<script lang="ts">
	import {
		defaultModelForPurpose,
		estimateFrameBudgetSeconds,
		formatDurationEstimate,
		formatModelSize,
		modelsForPurpose,
		type ModelPurpose,
		type ModelSpec,
	} from '$lib/ai/model-registry.js';
	import { ModelCache, ModelDownloadError, type DownloadProgress } from '$lib/ai/model-cache.js';
	import {
		AiUnavailableError,
		isRuntimeSupported,
		loadAiRuntime,
		preferredBackend,
		type AiSession,
	} from '$lib/ai/runtime.js';
	import { removeBackground } from '$lib/ai/background-removal.js';
	import { upscaleImage, countTiles, DEFAULT_UPSCALE_OPTIONS } from '$lib/ai/upscale.js';
	import { colorizeImage } from '$lib/ai/colorize.js';
	import type { RgbaImage } from '$lib/ai/tensor.js';

	interface Props {
		/**
		 * Hands back the frame to work on. Returning null means there is nothing
		 * selected — the panel says so rather than failing on Apply.
		 */
		getFrame?: (() => RgbaImage | null | Promise<RgbaImage | null>) | null;
		/**
		 * Receives the finished frame. The panel deliberately does not decide
		 * whether the result becomes a new asset, an overlay, or a download —
		 * that belongs to whoever mounts it.
		 */
		onResult?: ((image: RgbaImage, purpose: ModelPurpose) => void) | null;
	}

	let { getFrame = null, onResult = null }: Props = $props();

	const TOOLS: { purpose: ModelPurpose; label: string; blurb: string }[] = [
		{
			purpose: 'background-removal',
			label: 'Remove background',
			blurb: 'Cuts the subject out and leaves the rest transparent.',
		},
		{
			purpose: 'upscale',
			label: 'Upscale',
			blurb: 'Enlarges the frame and rebuilds detail. Slow on anything above SD.',
		},
		{
			purpose: 'colorize',
			label: 'Colourise',
			blurb: 'Adds plausible colour to black-and-white footage.',
		},
	];

	// A frame's worth of work is the honest unit here, but people think in
	// clips, so the cost line is quoted for a short one: 10 seconds at 30 fps.
	const SAMPLE_CLIP_FRAMES = 300;
	const HD_FRAME = { width: 1920, height: 1080 };

	let expanded = $state(false);
	let openTool = $state<ModelPurpose | null>(null);
	let modelIds = $state<Record<string, string>>({});
	/** Undefined until the lookup returns, so the UI can say "checking". */
	let cached = $state<Record<string, boolean | undefined>>({});
	let download = $state<DownloadProgress | null>(null);
	let downloadingId = $state<string | null>(null);
	let running = $state(false);
	let runProgress = $state(0);
	let status = $state('');
	let error = $state('');

	// Built lazily: constructing the store touches CacheStorage, which does not
	// exist during SSR.
	let cache: ModelCache | null = null;
	const sessions = new Map<string, AiSession>();

	let runtimeSupported = $derived(isRuntimeSupported());
	let selectedSpec = $derived.by(() => {
		if (!openTool) return null;
		const chosen = modelIds[openTool];
		const candidates = modelsForPurpose(openTool);
		return candidates.find((model) => model.id === chosen) ?? defaultModelForPurpose(openTool);
	});
	let selectedCached = $derived(selectedSpec ? cached[selectedSpec.id] === true : false);
	let busy = $derived(running || downloadingId !== null);

	// Refresh the cached flag whenever the visible model changes, so the panel
	// never offers a download for something already on disk.
	$effect(() => {
		const spec = selectedSpec;
		if (!spec || !runtimeSupported) return;

		let stale = false;
		void modelCache()
			.isCached(spec)
			.then((hit) => {
				if (!stale) cached = { ...cached, [spec.id]: hit };
			})
			.catch(() => {});

		return () => {
			stale = true;
		};
	});

	function modelCache(): ModelCache {
		return (cache ??= new ModelCache());
	}

	function toggleTool(purpose: ModelPurpose) {
		if (busy) return;
		openTool = openTool === purpose ? null : purpose;
		error = '';
		status = '';
	}

	function selectModel(purpose: ModelPurpose, id: string) {
		modelIds = { ...modelIds, [purpose]: id };
		error = '';
	}

	/** Turns anything thrown in this panel into something worth reading. */
	function describe(cause: unknown): string {
		if (cause instanceof AiUnavailableError) return cause.message;
		if (cause instanceof ModelDownloadError) return cause.message;
		if (cause instanceof Error) return cause.message;
		return 'Something went wrong running the model.';
	}

	async function handleDownload(spec: ModelSpec) {
		if (busy) return;
		error = '';
		status = '';
		downloadingId = spec.id;
		download = { received: 0, total: spec.bytes, fraction: 0 };

		try {
			const result = await modelCache().ensure(spec, {
				onProgress: (progress) => (download = progress),
			});
			cached = { ...cached, [spec.id]: true };
			status = result.verified
				? 'Downloaded and checked.'
				: 'Downloaded. No published checksum exists for this model, so it could not be verified.';
		} catch (cause) {
			if (!(cause instanceof ModelDownloadError && cause.cancelled)) error = describe(cause);
		} finally {
			downloadingId = null;
			download = null;
		}
	}

	async function handleRemoveDownload(spec: ModelSpec) {
		if (busy) return;
		await sessions.get(spec.id)?.release().catch(() => {});
		sessions.delete(spec.id);
		await modelCache().evict(spec);
		cached = { ...cached, [spec.id]: false };
		status = 'Removed from this device.';
	}

	/** Loads the runtime and the weights once, then keeps the session warm. */
	async function sessionFor(spec: ModelSpec): Promise<AiSession> {
		const existing = sessions.get(spec.id);
		if (existing) return existing;

		const runtime = await loadAiRuntime();
		status = 'Loading the model…';
		const { bytes } = await modelCache().ensure(spec, {
			onProgress: (progress) => (download = progress),
		});
		download = null;

		const session = await runtime.createSession(bytes);
		sessions.set(spec.id, session);
		return session;
	}

	async function handleApply() {
		const spec = selectedSpec;
		if (!spec || busy) return;

		error = '';
		status = '';
		runProgress = 0;

		let frame: RgbaImage | null = null;
		try {
			frame = (await getFrame?.()) ?? null;
		} catch (cause) {
			error = describe(cause);
			return;
		}
		if (!frame) {
			error = 'Nothing to work on — select a clip and park the playhead on a frame first.';
			return;
		}

		running = true;
		try {
			const session = await sessionFor(spec);
			status = 'Running…';

			let result: RgbaImage;
			if (spec.purpose === 'background-removal') {
				result = await removeBackground(frame, session, spec);
			} else if (spec.purpose === 'upscale') {
				result = await upscaleImage(frame, session, spec, {
					onProgress: (fraction) => (runProgress = fraction),
				});
			} else {
				result = await colorizeImage(frame, session, spec);
			}

			onResult?.(result, spec.purpose);
			status = 'Done — applied to the current frame.';
		} catch (cause) {
			error = describe(cause);
		} finally {
			running = false;
			runProgress = 0;
			download = null;
		}
	}

	function downloadPercent(progress: DownloadProgress): number {
		return Math.round((progress.fraction ?? 0) * 100);
	}

	/**
	 * Upscalers are quoted per tile rather than per frame, because their real
	 * cost depends on the frame size and quoting the tile figure alone would
	 * understate a 1080p run by a factor of forty.
	 */
	function costLine(spec: ModelSpec): string {
		const perRun = (spec.wasmFrameMs / 1000).toFixed(1);
		if (spec.purpose === 'upscale') {
			const tiles = countTiles(HD_FRAME, DEFAULT_UPSCALE_OPTIONS);
			const perFrame = formatDurationEstimate((spec.wasmFrameMs * tiles) / 1000);
			return `About ${perRun}s per tile. A 1080p frame is ${tiles} tiles, so ${perFrame} for one frame.`;
		}
		const clip = formatDurationEstimate(estimateFrameBudgetSeconds(spec, SAMPLE_CLIP_FRAMES));
		return `About ${perRun}s per frame, so ${clip} for a 10-second clip.`;
	}
</script>

<div class="ai-tools">
	<button class="section-head" onclick={() => (expanded = !expanded)}>
		<span class="chevron" class:open={expanded}>▸</span>
		<h4>AI tools</h4>
		<span class="badge">on-device</span>
	</button>

	{#if expanded}
		<p class="hint">
			These run entirely on your machine — nothing is uploaded and no account is needed. Each tool
			downloads its model the first time you use it.
		</p>

		{#if !runtimeSupported}
			<p class="notice warn">
				On-device AI needs WebAssembly, which this browser does not offer. The rest of the editor is
				unaffected.
			</p>
		{:else}
			{#each TOOLS as tool (tool.purpose)}
				{@const active = openTool === tool.purpose}
				<div class="tool" class:open={active}>
					<button class="tool-head" onclick={() => toggleTool(tool.purpose)} disabled={busy && !active}>
						<span class="tool-name">{tool.label}</span>
						<span class="chevron" class:open={active}>▸</span>
					</button>

					{#if active && selectedSpec}
						{@const spec = selectedSpec}
						<div class="body">
							<p class="blurb">{tool.blurb}</p>

							{#if modelsForPurpose(tool.purpose).length > 1}
								<div class="models">
									{#each modelsForPurpose(tool.purpose) as option (option.id)}
										<button
											class="model"
											class:on={option.id === spec.id}
											disabled={busy}
											onclick={() => selectModel(tool.purpose, option.id)}
										>
											{option.name}
											<em>{formatModelSize(option.bytes)}</em>
										</button>
									{/each}
								</div>
							{/if}

							<p class="blurb">{spec.summary}</p>

							{#if !spec.commercialUse}
								<p class="notice warn">
									{spec.name} is licensed for non-commercial use only ({spec.licence}).
								</p>
							{/if}

							{#if downloadingId === spec.id && download}
								<div class="progress">
									<div class="bar">
										<div class="fill" style="width: {downloadPercent(download)}%"></div>
									</div>
									<span class="progress-label">
										Downloading {formatModelSize(download.received)}
										{#if download.total}/ {formatModelSize(download.total)}{/if}
									</span>
								</div>
							{:else if cached[spec.id] === undefined}
								<p class="cost">Checking whether the model is already on this device…</p>
							{:else if !cached[spec.id]}
								<p class="notice">
									Model not downloaded yet ({formatModelSize(spec.bytes)}). It is kept on this
									device afterwards, so you only pay for it once.
								</p>
								<button class="primary" onclick={() => handleDownload(spec)} disabled={busy}>
									Download {formatModelSize(spec.bytes)}
								</button>
							{/if}

							{#if selectedCached}
								<p class="cost">
									{costLine(spec)}
									The first run is slower still while the model warms up.
								</p>
								{#if spec.purpose === 'upscale'}
									<p class="cost">
										Output is {spec.scale}× each side, so {spec.scale * spec.scale}× the pixels.
									</p>
								{/if}

								{#if running && runProgress > 0}
									<div class="progress">
										<div class="bar">
											<div class="fill" style="width: {Math.round(runProgress * 100)}%"></div>
										</div>
										<span class="progress-label">{Math.round(runProgress * 100)}%</span>
									</div>
								{/if}

								<button class="primary" onclick={handleApply} disabled={busy || !getFrame}>
									{running ? 'Working…' : 'Apply to current frame'}
								</button>
								<p class="cost">
									Applies to the single frame under the playhead. Running a whole clip means one
									pass per frame — start it deliberately, not by accident.
								</p>
								<button class="link" onclick={() => handleRemoveDownload(spec)} disabled={busy}>
									Remove download ({formatModelSize(spec.bytes)})
								</button>
							{/if}

							<p class="meta">
								{spec.licence} · runs on {preferredBackend() === 'webgpu' ? 'WebGPU' : 'WebAssembly'}
							</p>
						</div>
					{/if}
				</div>
			{/each}

			{#if status}
				<p class="notice ok">{status}</p>
			{/if}
			{#if error}
				<p class="notice bad">{error}</p>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.ai-tools { padding: 8px 0; }

	.section-head {
		display: flex; align-items: center; gap: 6px; width: 100%;
		background: none; border: none; padding: 4px 0; cursor: pointer;
		color: var(--text-primary);
	}
	.section-head h4 { font-size: 12px; font-weight: 600; margin: 0; }

	.chevron { font-size: 10px; color: var(--text-tertiary); transition: transform 0.15s ease; }
	.chevron.open { transform: rotate(90deg); }

	.badge {
		font-size: 10px; padding: 1px 6px; border-radius: 8px;
		background: rgba(255, 255, 255, 0.08); color: var(--text-tertiary);
	}

	.hint { font-size: 11px; color: var(--text-tertiary); margin: 4px 0 8px; line-height: 1.4; }

	.tool { border-top: 1px solid var(--border-primary); }

	.tool-head {
		display: flex; align-items: center; justify-content: space-between; width: 100%;
		background: none; border: none; padding: 6px 0; cursor: pointer;
		color: var(--text-secondary); font-size: 11px;
	}
	.tool-head:disabled { opacity: 0.4; cursor: default; }
	.tool.open .tool-head { color: var(--text-primary); }
	.tool-name { text-align: left; }

	.body { display: flex; flex-direction: column; gap: 6px; padding: 0 0 8px; }

	.blurb { font-size: 11px; color: var(--text-tertiary); margin: 0; line-height: 1.4; }

	.models { display: flex; flex-wrap: wrap; gap: 4px; }
	.models .model {
		flex: 1 1 auto; font-size: 10px; padding: 4px 6px; cursor: pointer;
		background: var(--bg-surface); color: var(--text-secondary);
		border: 1px solid var(--border-primary); border-radius: 4px;
		display: flex; flex-direction: column; gap: 1px; text-align: left;
	}
	.models .model.on { border-color: var(--border-focus); color: var(--text-primary); }
	.models .model:disabled { opacity: 0.5; cursor: default; }
	.models em { font-style: normal; color: var(--text-muted); font-variant-numeric: tabular-nums; }

	.notice {
		font-size: 11px; line-height: 1.4; margin: 0; padding: 6px 8px;
		border-radius: var(--radius-sm); background: rgba(255, 255, 255, 0.04);
		color: var(--text-secondary);
	}
	.notice.warn { color: var(--warning); background: rgba(255, 170, 0, 0.08); }
	.notice.bad { color: var(--danger); background: rgba(255, 68, 68, 0.08); }
	.notice.ok { color: var(--success); background: rgba(68, 255, 68, 0.06); }

	.cost { font-size: 10px; color: var(--text-muted); margin: 0; line-height: 1.4; }

	.progress { display: flex; flex-direction: column; gap: 3px; }
	.bar { height: 4px; background: var(--bg-surface); border-radius: 2px; overflow: hidden; }
	.fill { height: 100%; background: var(--text-primary); transition: width 0.2s ease; }
	.progress-label {
		font-size: 10px; color: var(--text-muted);
		font-family: var(--font-mono); font-variant-numeric: tabular-nums;
	}

	.primary {
		width: 100%; padding: 6px; font-size: 11px; cursor: pointer;
		background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border-primary);
		border-radius: 5px; color: var(--text-primary);
	}
	.primary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
	.primary:disabled { opacity: 0.45; cursor: default; }

	.link {
		background: none; border: none; padding: 0; cursor: pointer;
		font-size: 10px; color: var(--text-muted); text-align: left;
	}
	.link:hover:not(:disabled) { color: var(--text-secondary); }
	.link:disabled { opacity: 0.45; cursor: default; }

	.meta { font-size: 10px; color: var(--text-muted); margin: 0; }
</style>
