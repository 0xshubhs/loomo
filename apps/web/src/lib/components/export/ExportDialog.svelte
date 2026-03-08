<script lang="ts">
	import { getUI, getTimeline } from '$lib/state/context.js';
	import type { ExportConfig, ExportFormat, ExportProgress, Resolution } from '$lib/types/index.js';
	import { FORMAT_DEFAULTS } from '$lib/types/export.js';
	import Modal from '../shared/Modal.svelte';
	import Button from '../shared/Button.svelte';
	import Dropdown from '../shared/Dropdown.svelte';
	import Slider from '../shared/Slider.svelte';
	import ExportProgressBar from './ExportProgress.svelte';

	const ui = getUI();
	const timeline = getTimeline();

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

	let config = $derived<ExportConfig>({
		format,
		videoCodec: FORMAT_DEFAULTS[format].videoCodec,
		audioCodec: FORMAT_DEFAULTS[format].audioCodec,
		resolution,
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

	const formatOptions = [
		{ value: 'mp4', label: 'MP4 (H.264)' },
		{ value: 'webm', label: 'WebM (VP9)' },
		{ value: 'mkv', label: 'MKV (H.264)' },
		{ value: 'avi', label: 'AVI' },
		{ value: 'mov', label: 'MOV' },
	];

	const resolutionOptions = [
		{ value: '4k', label: '4K (3840x2160)' },
		{ value: '1080p', label: '1080p (1920x1080)' },
		{ value: '720p', label: '720p (1280x720)' },
		{ value: '480p', label: '480p (854x480)' },
	];
</script>

<Modal bind:open={ui.showExportDialog} title="Export" onclose={handleClose}>
	{#if exporting && exportProgress}
		<ExportProgressBar progress={exportProgress} />
	{:else}
		<div class="export-form">
			<Dropdown label="Format" value={format} options={formatOptions} onchange={(v) => format = v as ExportFormat} />

			<Dropdown label="Resolution" value={resolution} options={resolutionOptions} onchange={(v) => resolution = v as Resolution} />

			<div class="field-row">
				<Slider label="FPS" bind:value={fps} min={15} max={60} step={1} />
			</div>

			<div class="field-row">
				<Slider label="Video Bitrate (kbps)" bind:value={videoBitrate} min={500} max={50000} step={500} />
			</div>

			<div class="field-row">
				<Slider label="Audio Bitrate (kbps)" bind:value={audioBitrate} min={64} max={320} step={32} />
			</div>

			<div class="export-info">
				<span>Duration: {Math.round(timeline.totalDuration)}s</span>
				<span>Tracks: {timeline.tracks.length}</span>
				<span>Clips: {timeline.flatClips.length}</span>
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

	.export-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding-top: 8px;
	}
</style>
