<script lang="ts">
	import { getUI, getTimeline, getSelection, getMediaLibrary, getCommands } from '$lib/state/context.js';
	import { detectSilences, analyzeAudioFromBlob, type SilenceRegion, type SilenceOptions } from '$lib/engine/silence-detector.js';
	import { RemoveSilencesCommand } from '$lib/commands/clip-commands.js';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Slider from './Slider.svelte';

	const ui = getUI();
	const timeline = getTimeline();
	const selection = getSelection();
	const mediaLibrary = getMediaLibrary();
	const commands = getCommands();

	let threshold = $state(0.01);
	let minDuration = $state(0.5);
	let analyzing = $state(false);
	let analyzed = $state(false);
	let errorText = $state('');
	let silences = $state<SilenceRegion[]>([]);
	let selected = $state<boolean[]>([]);
	let audioBuffer: AudioBuffer | null = null;

	// Threshold display as percentage for the slider
	let thresholdPercent = $state(1);

	$effect(() => {
		threshold = thresholdPercent / 100;
	});

	function getSelectedClip() {
		for (const clipId of selection.selectedClipIds) {
			const clip = timeline.getClipById(clipId);
			if (clip && (clip.type === 'video' || clip.type === 'audio')) {
				return clip;
			}
		}
		return null;
	}

	async function handleAnalyze() {
		errorText = '';
		const clip = getSelectedClip();
		if (!clip) {
			errorText = 'No audio/video clip selected.';
			return;
		}

		const asset = mediaLibrary.getAssetById(clip.assetId);
		if (!asset) {
			errorText = 'Could not find media asset.';
			return;
		}

		analyzing = true;

		try {
			if (!audioBuffer) {
				const response = await fetch(asset.blobUrl);
				const blob = await response.blob();
				audioBuffer = await analyzeAudioFromBlob(blob);
			}

			const options: SilenceOptions = { threshold, minDuration };
			silences = detectSilences(audioBuffer, options);
			selected = silences.map(() => true);
			analyzed = true;

			if (silences.length === 0) {
				errorText = 'No silences detected with current settings. Try increasing the threshold or decreasing the minimum duration.';
			}
		} catch (err) {
			errorText = `Analysis failed: ${err}`;
		} finally {
			analyzing = false;
		}
	}

	function handleReanalyze() {
		handleAnalyze();
	}

	function handleSelectAll() {
		selected = silences.map(() => true);
	}

	function handleDeselectAll() {
		selected = silences.map(() => false);
	}

	function toggleRegion(index: number) {
		selected[index] = !selected[index];
		selected = [...selected];
	}

	function handleApply() {
		const clip = getSelectedClip();
		if (!clip) return;

		const selectedSilences = silences.filter((_, i) => selected[i]);
		if (selectedSilences.length === 0) return;

		commands.execute(new RemoveSilencesCommand(timeline, clip.id, selectedSilences));
		selection.deselectAll();
		handleClose();
	}

	function handleClose() {
		ui.showSilenceRemoval = false;
		analyzed = false;
		silences = [];
		selected = [];
		audioBuffer = null;
		errorText = '';
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = (seconds % 60).toFixed(1);
		return `${m}:${s.padStart(4, '0')}`;
	}

	function formatDuration(seconds: number): string {
		return `${seconds.toFixed(2)}s`;
	}

	let selectedCount = $derived(selected.filter(Boolean).length);
	let totalSilenceDuration = $derived(
		silences
			.filter((_, i) => selected[i])
			.reduce((sum, s) => sum + s.duration, 0)
	);

	// Auto-analyze when dialog opens
	$effect(() => {
		if (ui.showSilenceRemoval && !analyzed && !analyzing) {
			handleAnalyze();
		}
	});
</script>

<Modal bind:open={ui.showSilenceRemoval} title="Remove Silences" onclose={handleClose}>
	<div class="silence-dialog">
		<!-- Settings -->
		<div class="section">
			<div class="section-title">Detection Settings</div>
			<div class="settings-grid">
				<Slider
					label="Threshold"
					bind:value={thresholdPercent}
					min={0.1}
					max={10}
					step={0.1}
				/>
				<Slider
					label="Min Duration"
					bind:value={minDuration}
					min={0.1}
					max={5}
					step={0.1}
				/>
			</div>
			<div class="row actions">
				{#if analyzing}
					<div class="analyzing">
						<div class="pulse-dot"></div>
						<span class="status">Analyzing audio...</span>
					</div>
				{:else}
					<Button variant="ghost" size="sm" onclick={handleReanalyze}>
						Re-analyze
					</Button>
				{/if}
			</div>
		</div>

		{#if errorText}
			<div class="error">{errorText}</div>
		{/if}

		<!-- Results -->
		{#if analyzed && silences.length > 0}
			<div class="section">
				<div class="section-title">
					Detected Silences ({silences.length})
					{#if selectedCount > 0}
						<span class="summary">
							&mdash; {selectedCount} selected, {formatDuration(totalSilenceDuration)} total
						</span>
					{/if}
				</div>

				<div class="bulk-actions">
					<Button variant="ghost" size="sm" onclick={handleSelectAll}>Remove All</Button>
					<Button variant="ghost" size="sm" onclick={handleDeselectAll}>Keep All</Button>
				</div>

				<div class="region-list">
					{#each silences as region, i (i)}
						<button
							class="region-item"
							class:excluded={!selected[i]}
							onclick={() => toggleRegion(i)}
						>
							<input
								type="checkbox"
								checked={selected[i]}
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleRegion(i)}
								class="region-check"
							/>
							<span class="region-time">
								{formatTime(region.startTime)} - {formatTime(region.endTime)}
							</span>
							<span class="region-duration">{formatDuration(region.duration)}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="section apply-section">
				<Button
					variant="primary"
					size="sm"
					onclick={handleApply}
					disabled={selectedCount === 0}
				>
					Apply ({selectedCount} silences)
				</Button>
			</div>
		{/if}
	</div>
</Modal>

<style>
	.silence-dialog {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.section-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.summary {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-muted);
	}

	.settings-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.actions {
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
	}

	.analyzing {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.pulse-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #4488ff;
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.8); }
	}

	.status {
		font-size: 12px;
	}

	.error {
		font-size: 12px;
		color: #ff4444;
		padding: 8px;
		background: rgba(255, 68, 68, 0.1);
		border-radius: var(--radius-sm);
	}

	.bulk-actions {
		display: flex;
		gap: 4px;
	}

	.region-list {
		max-height: 240px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		padding: 4px;
	}

	.region-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		background: transparent;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-family: inherit;
		transition: background 0.1s;
	}

	.region-item:hover {
		background: var(--bg-hover);
	}

	.region-item.excluded {
		opacity: 0.4;
	}

	.region-check {
		flex-shrink: 0;
		cursor: pointer;
	}

	.region-time {
		flex-shrink: 0;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-secondary);
		min-width: 100px;
	}

	.region-duration {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-muted);
		margin-left: auto;
	}

	.apply-section {
		align-items: flex-end;
	}
</style>
