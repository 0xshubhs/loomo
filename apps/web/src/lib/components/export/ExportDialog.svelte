<script lang="ts">
	import { getUI, getTimeline, getProject, getMediaLibrary } from '$lib/state/context.js';
	import { requiredCredits, formatCredits } from '$lib/utils/attribution.js';
	import { copyToClipboard } from '$lib/utils/clipboard.js';
	import type { ExportConfig, ExportFormat, ExportProgress, Resolution } from '$lib/types/index.js';
	import { FORMAT_DEFAULTS, BITRATE_FOR_RESOLUTION } from '$lib/types/export.js';
	import { scaleToResolution } from '$lib/utils/aspect-ratios.js';
	import Modal from '../shared/Modal.svelte';
	import Button from '../shared/Button.svelte';
	import Dropdown from '../shared/Dropdown.svelte';
	import Slider from '../shared/Slider.svelte';
	import ExportProgressBar from './ExportProgress.svelte';

	const ui = getUI();
	const timeline = getTimeline();
	const project = getProject();
	const mediaLibrary = getMediaLibrary();

	let credits = $derived(requiredCredits(mediaLibrary.assets));
	let copied = $state(false);

	async function copyCredits() {
		copied = await copyToClipboard(formatCredits(credits));
		if (copied) setTimeout(() => (copied = false), 2000);
	}

	interface Props {
		ffmpegReady?: boolean;
		/**
		 * Live export progress, owned by the page that runs the export.
		 *
		 * This used to be local state here that nothing ever assigned, so the
		 * progress bar could never render: an export showed no feedback at all
		 * and simply looked hung — badly so on a 4K render, which takes minutes.
		 */
		progress?: ExportProgress | null;
		onexport?: (config: ExportConfig) => void;
	}

	let { ffmpegReady = false, progress = null, onexport }: Props = $props();

	let format = $state<ExportFormat>('mp4');
	let resolution = $state<Resolution>('1080p');
	let fps = $state(30);
	let audioBitrate = $state(192);
	// On by default: clips cut together routinely differ by 10dB or more, and
	// the faithful result is the one that sounds broken.
	let normalizeLoudness = $state(true);
	let quality = $state(23);
	let exporting = $state(false);

	// Follows the resolution until the user moves the slider themselves. One
	// fixed default meant 4K was encoded at a 1080p bitrate, which looks worse
	// than the source it came from.
	let bitrateOverride = $state<number | null>(null);
	let videoBitrate = $derived(bitrateOverride ?? BITRATE_FOR_RESOLUTION[resolution]);

	/**
	 * The largest video in the timeline, which is the most detail an export can
	 * possibly contain. Anything above it is upscaling.
	 */
	let sourceHeight = $derived.by(() => {
		const heights = timeline.tracks
			.flatMap((t) => t.clips)
			.map((clip) => mediaLibrary.getAssetById(clip.assetId)?.metadata.height ?? 0)
			.filter((h) => h > 0);
		return heights.length > 0 ? Math.max(...heights) : 0;
	});


	let exportDimensions = $derived(scaleToResolution(project.aspectRatio.label, resolution as '4k' | '1080p' | '720p' | '480p'));

	let upscaling = $derived(sourceHeight > 0 && exportDimensions.height > sourceHeight);

	let config = $derived<ExportConfig>({
		format,
		videoCodec: FORMAT_DEFAULTS[format].videoCodec,
		audioCodec: FORMAT_DEFAULTS[format].audioCodec,
		resolution,
		customWidth: exportDimensions.width,
		customHeight: exportDimensions.height,
		fps,
		videoBitrate,
		audioBitrate,
		quality,
		normalizeLoudness,
	});

	function handleExport() {
		exporting = true;
		onexport?.(config);
	}

	function handleClose() {
		if (!exporting) {
			ui.showExportDialog = false;
		}
	}

	// Release the dialog when the run ends, so a failed export can be retried
	// or dismissed instead of trapping the user behind a modal that never closes.
	$effect(() => {
		if (progress?.stage === 'done' || progress?.stage === 'error') {
			exporting = false;
		}
	});

	let isGif = $derived(format === 'gif');
	let isAudioOnly = $derived(format === 'm4a');
	let gifWarning = $derived(isGif && timeline.totalDuration > 15 ? 'GIF recommended for clips under 15 seconds' : '');

	const formatOptions = [
		{ value: 'mp4', label: 'MP4 (H.264)' },
		{ value: 'webm', label: 'WebM (VP9)' },
		{ value: 'mkv', label: 'MKV (H.264)' },
		{ value: 'avi', label: 'AVI' },
		{ value: 'mov', label: 'MOV' },
		{ value: 'gif', label: 'GIF (Animated)' },
		{ value: 'm4a', label: 'M4A (Audio Only)' },
	];

	let resolutionOptions = $derived(
		(['4k', '1080p', '720p', '480p'] as const).map((tier) => {
			const dims = scaleToResolution(project.aspectRatio.label, tier);
			const label = tier === '4k' ? '4K' : tier;
			return { value: tier, label: `${label} (${dims.width}x${dims.height})` };
		})
	);
</script>

<Modal bind:open={ui.showExportDialog} title="Export" onclose={handleClose}>
	{#if exporting}
		<ExportProgressBar progress={progress ?? {
			stage: 'preparing', progress: 0, currentFrame: 0,
			totalFrames: 0, elapsed: 0, eta: 0, outputSize: 0,
		}} />
	{:else}
		<div class="export-form">
			<Dropdown label="Format" value={format} options={formatOptions} onchange={(v) => format = v as ExportFormat} />

			{#if gifWarning}
				<div class="gif-warning">{gifWarning}</div>
			{/if}

			{#if !isAudioOnly}
				<Dropdown label="Resolution" value={resolution} options={resolutionOptions} onchange={(v) => resolution = v as Resolution} />

				{#if upscaling}
					<!-- Picking 4K for 720p footage produces a 4K file that looks
					     exactly like 720p and is many times the size. Saying so
					     beforehand is cheaper than a 13-minute render. -->
					<div class="notice">
						Your footage is {sourceHeight}p. Exporting at {exportDimensions.height}p
						upscales it — the file gets larger, not sharper.
					</div>
				{/if}

				<div class="field-row">
					<Slider label="FPS" bind:value={fps} min={isGif ? 10 : 15} max={isGif ? 30 : 60} step={1} />
				</div>

				{#if !isGif}
					<div class="field-row">
						<Slider
							label="Video Bitrate (kbps)"
							value={videoBitrate}
							oninput={(v) => (bitrateOverride = v)}
							min={500}
							max={60000}
							step={500}
						/>
					</div>
				{/if}
			{/if}

			{#if !isGif}
				<label class="toggle-row">
					<input type="checkbox" bind:checked={normalizeLoudness} />
					<span>
						Match clip loudness
						<small>Brings quiet and loud clips to the same level</small>
					</span>
				</label>

				<div class="field-row">
					<Slider label="Audio Bitrate (kbps)" bind:value={audioBitrate} min={64} max={320} step={32} />
				</div>
			{/if}

			<div class="export-info">
				<span>Duration: {Math.round(timeline.totalDuration)}s</span>
				<span>Tracks: {timeline.tracks.length}</span>
				<span>Clips: {timeline.flatClips.length}</span>
				<span>Ratio: {project.aspectRatio.label} ({exportDimensions.width}x{exportDimensions.height})</span>
			</div>

			{#if credits.length > 0}
				<!-- Surfaced at export because this is the moment the video is
				     about to leave the machine, and the obligation attaches to
				     publishing it. -->
				<div class="credits">
					<div class="credits-head">
						<span class="credits-title">Attribution required ({credits.length})</span>
						<button class="credits-copy" onclick={copyCredits}>
							{copied ? 'Copied' : 'Copy'}
						</button>
					</div>
					<p class="credits-note">
						These tracks are CC BY licensed. Include this credit wherever you publish.
					</p>
					<ul class="credits-list">
						{#each credits as credit}
							<li>{credit.text}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="export-actions">
				<Button variant="secondary" onclick={handleClose}>Cancel</Button>
				<Button variant="primary" onclick={handleExport} disabled={!ffmpegReady || timeline.flatClips.length === 0}>
					Export
				</Button>
			</div>
		</div>
	{/if}
</Modal>

<style>
	.export-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.field-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.export-info {
		display: flex;
		gap: 16px;
		font-size: 10px;
		color: var(--text-muted);
		padding: 8px 0;
		border-top: 1px solid var(--border-primary);
	}

	.toggle-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 12px;
		color: var(--text-primary);
		cursor: pointer;
	}

	.toggle-row input {
		margin-top: 2px;
		accent-color: var(--accent-primary, #ff5f45);
	}

	.toggle-row small {
		display: block;
		color: var(--text-muted);
		font-size: 11px;
		margin-top: 1px;
	}

	.notice {
		padding: 8px 10px;
		border: 1px solid rgba(255, 176, 32, 0.35);
		border-radius: 6px;
		background: rgba(255, 176, 32, 0.08);
		color: var(--text-primary);
		font-size: 11px;
		line-height: 1.45;
	}

	.gif-warning {
		font-size: 11px;
		color: #e8913a;
		padding: 6px 10px;
		background: rgba(232, 145, 58, 0.1);
		border-radius: 4px;
		border: 1px solid rgba(232, 145, 58, 0.2);
	}

	.credits {
		margin-top: 12px;
		padding: 8px 10px;
		border-radius: 6px;
		background: rgba(255, 170, 0, 0.08);
		border: 1px solid rgba(255, 170, 0, 0.25);
	}

	.credits-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.credits-title {
		font-size: 11px;
		font-weight: 600;
		color: #ffbf5f;
	}

	.credits-copy {
		font-size: 10px;
		padding: 2px 8px;
		cursor: pointer;
		background: rgba(255, 255, 255, 0.07);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		color: var(--text-secondary);
	}

	.credits-copy:hover {
		color: var(--text-primary);
	}

	.credits-note {
		font-size: 10px;
		color: var(--text-tertiary);
		margin: 4px 0 6px;
		line-height: 1.4;
	}

	.credits-list {
		margin: 0;
		padding-left: 16px;
		max-height: 96px;
		overflow-y: auto;
	}

	.credits-list li {
		font-size: 10px;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.export-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding-top: 8px;
	}
</style>
