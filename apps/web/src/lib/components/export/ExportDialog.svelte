<script lang="ts">
	import { getUI, getTimeline, getProject } from '$lib/state/context.js';
	import type { ExportConfig, ExportFormat, ExportProgress, Resolution } from '$lib/types/index.js';
	import { FORMAT_DEFAULTS } from '$lib/types/export.js';
	import { scaleToResolution } from '$lib/utils/aspect-ratios.js';
	import Modal from '../shared/Modal.svelte';
	import Button from '../shared/Button.svelte';
	import Dropdown from '../shared/Dropdown.svelte';
	import Slider from '../shared/Slider.svelte';
	import ExportProgressBar from './ExportProgress.svelte';

	const ui = getUI();
	const timeline = getTimeline();
	const project = getProject();

	interface Props {
		ffmpegReady?: boolean;
		onexport?: (config: ExportConfig) => void;
	}

	let { ffmpegReady = false, onexport }: Props = $props();

	let format = $state<ExportFormat>('mp4');
	let resolution = $state<Resolution>('1080p');
	let fps = $state(30);
	let videoBitrate = $state(5000);
	let audioBitrate = $state(192);
	let quality = $state(23);
	let exporting = $state(false);
	let exportProgress = $state<ExportProgress | null>(null);

	let exportDimensions = $derived(scaleToResolution(project.aspectRatio.label, resolution as '4k' | '1080p' | '720p' | '480p'));

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
	{#if exporting && exportProgress}
		<ExportProgressBar progress={exportProgress} />
	{:else}
		<div class="export-form">
			<Dropdown label="Format" value={format} options={formatOptions} onchange={(v) => format = v as ExportFormat} />

			{#if gifWarning}
				<div class="gif-warning">{gifWarning}</div>
			{/if}

			{#if !isAudioOnly}
				<Dropdown label="Resolution" value={resolution} options={resolutionOptions} onchange={(v) => resolution = v as Resolution} />

				<div class="field-row">
					<Slider label="FPS" bind:value={fps} min={isGif ? 10 : 15} max={isGif ? 30 : 60} step={1} />
				</div>

				{#if !isGif}
					<div class="field-row">
						<Slider label="Video Bitrate (kbps)" bind:value={videoBitrate} min={500} max={50000} step={500} />
					</div>
				{/if}
			{/if}

			{#if !isGif}
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

	.gif-warning {
		font-size: 11px;
		color: #e8913a;
		padding: 6px 10px;
		background: rgba(232, 145, 58, 0.1);
		border-radius: 4px;
		border: 1px solid rgba(232, 145, 58, 0.2);
	}

	.export-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding-top: 8px;
	}
</style>
