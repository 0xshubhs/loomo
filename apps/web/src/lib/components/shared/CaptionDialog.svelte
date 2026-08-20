<script lang="ts">
	import { untrack } from 'svelte';
	import { getCaptions, getTimeline, getMediaLibrary, getUI } from '$lib/state/context.js';
	import { transcribeAudio, isSpeechRecognitionSupported, SUPPORTED_LANGUAGES } from '$lib/engine/speech-recognition.js';
	import { downloadSRT } from '$lib/utils/srt.js';
	import type { CaptionSegment, CaptionStyle } from '$lib/types/index.js';
	import { assetBlob } from '$lib/engine/asset-bytes.js';
	import { transcribeInWindows, CANCELLED_MESSAGE } from '$lib/engine/windowed-transcription.js';
	import type { FFmpegEngine } from '$lib/engine/ffmpeg-engine.js';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Dropdown from './Dropdown.svelte';
	import Slider from './Slider.svelte';

	interface Props {
		/** Needed to read an asset whose bytes live on disk rather than in the page. */
		ffmpeg?: FFmpegEngine;
	}

	let { ffmpeg }: Props = $props();

	const captions = getCaptions();
	const timeline = getTimeline();
	const mediaLibrary = getMediaLibrary();
	const ui = getUI();

	let language = $state('en-US');
	let transcribing = $state(false);
	let statusText = $state('');
	let errorText = $state('');
	let abortController: AbortController | null = null;
	let showStyleEditor = $state(false);

	// Local style state bound to caption store
	let fontFamily = $state(captions.captionTrack.style.fontFamily);
	let fontSize = $state(captions.captionTrack.style.fontSize);
	let fontColor = $state(captions.captionTrack.style.fontColor);
	let backgroundColor = $state(captions.captionTrack.style.backgroundColor);
	let position = $state<CaptionStyle['position']>(captions.captionTrack.style.position);
	let alignment = $state<CaptionStyle['alignment']>(captions.captionTrack.style.alignment);
	let bgTransparent = $state(captions.captionTrack.style.backgroundColor === 'transparent');

	const isSupported = isSpeechRecognitionSupported();

	const languageOptions = SUPPORTED_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));

	const fontOptions = [
		{ value: 'Arial', label: 'Arial' },
		{ value: 'Helvetica', label: 'Helvetica' },
		{ value: 'Georgia', label: 'Georgia' },
		{ value: 'Times New Roman', label: 'Times New Roman' },
		{ value: 'Courier New', label: 'Courier New' },
		{ value: 'Verdana', label: 'Verdana' },
		{ value: 'Impact', label: 'Impact' },
		{ value: 'Comic Sans MS', label: 'Comic Sans MS' },
	];

	function syncStyleToStore() {
		captions.updateCaptionStyle({
			fontFamily,
			fontSize,
			fontColor,
			backgroundColor: bgTransparent ? 'transparent' : backgroundColor,
			position,
			alignment,
		});
	}

	// Push local style edits into the store when any of them changes.
	//
	// The write must be untracked. `updateCaptionStyle` merges into the
	// existing style, so it reads `captionTrack.style` and then assigns it —
	// and a read inside a tracked effect becomes a dependency that the
	// following write immediately invalidates. That cycle threw
	// `effect_update_depth_exceeded` on editor mount, which tears down Svelte's
	// effect tree: the UI then stopped updating entirely, so imported media
	// never appeared even though the import itself had succeeded.
	$effect(() => {
		void fontFamily, fontSize, fontColor, backgroundColor, position, alignment, bgTransparent;
		untrack(() => syncStyleToStore());
	});

	async function handleGenerate() {
		errorText = '';

		// Find audio source from timeline
		const videoTrack = timeline.tracks.find((t) => t.type === 'video' && t.clips.length > 0);
		if (!videoTrack || videoTrack.clips.length === 0) {
			errorText = 'No video clips in timeline to transcribe.';
			return;
		}

		const firstClip = videoTrack.clips[0];
		const asset = mediaLibrary.getAssetById(firstClip.assetId);
		if (!asset) {
			errorText = 'Could not find media asset for transcription.';
			return;
		}

		transcribing = true;
		statusText = 'Preparing audio...';
		abortController = new AbortController();

		try {
			// A window at a time when there is a scratch copy and an engine to
			// read it with. The whole-file route below decodes the entire
			// source into the page — ~40MB per minute — which put a 50-minute
			// recording over a gigabyte and made captions unavailable on
			// exactly the files people want them for.
			const segments =
				asset.scratchName && ffmpeg
					? await transcribeInWindows({
							engine: ffmpeg,
							scratchName: asset.scratchName,
							assetId: asset.id,
							durationSeconds: asset.metadata.duration,
							language,
							onProgress: (status) => { statusText = status; },
							abortSignal: abortController.signal,
						})
					: await transcribeAudio(
							// Not `fetch(asset.blobUrl)`: an asset picked through
							// the OS dialog has no blob url, because its bytes
							// never entered the page.
							await assetBlob(asset, ffmpeg),
							language,
							(status) => { statusText = status; },
							abortController.signal
						);

			if (segments.length === 0) {
				errorText = 'No speech detected. Try a different language or ensure the video has audible speech.';
			} else {
				captions.setCaptions(segments);
			}
		} catch (err: any) {
			if (err.message !== CANCELLED_MESSAGE) {
				errorText = err.message || 'Transcription failed';
			}
		} finally {
			transcribing = false;
			statusText = '';
			abortController = null;
		}
	}

	function handleCancel() {
		abortController?.abort();
	}

	function handleClear() {
		captions.clearCaptions();
	}

	function handleToggle() {
		captions.toggleCaptions();
	}

	function handleExportSRT() {
		if (captions.captionTrack.segments.length === 0) return;
		downloadSRT(captions.captionTrack.segments, 'captions');
	}

	function handleSegmentEdit(id: string, e: Event) {
		const target = e.target as HTMLElement;
		captions.updateSegmentText(id, target.textContent ?? '');
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleClose() {
		ui.showCaptionDialog = false;
	}
</script>

<Modal bind:open={ui.showCaptionDialog} title="Auto Captions" onclose={handleClose}>
	{#if !isSupported}
		<div class="unsupported">
			<p>Web Speech API is not supported in this browser.</p>
			<p class="hint">Please use Google Chrome or Microsoft Edge for auto-captioning.</p>
		</div>
	{:else}
		<div class="caption-dialog">
			<!-- Generation Controls -->
			<div class="section">
				<div class="row">
					<Dropdown
						label="Language"
						value={language}
						options={languageOptions}
						onchange={(v) => { language = v; }}
					/>
				</div>

				<div class="row actions">
					{#if transcribing}
						<div class="transcribing">
							<div class="pulse-dot"></div>
							<span class="status">{statusText || 'Listening...'}</span>
						</div>
						<Button variant="ghost" size="sm" onclick={handleCancel}>Cancel</Button>
					{:else}
						<Button variant="primary" size="sm" onclick={handleGenerate}>
							Generate Captions
						</Button>
						{#if captions.hasSegments}
							<Button variant="ghost" size="sm" onclick={handleToggle}>
								{captions.captionTrack.enabled ? 'Disable' : 'Enable'}
							</Button>
							<Button variant="ghost" size="sm" onclick={handleClear}>
								Clear
							</Button>
							<Button variant="ghost" size="sm" onclick={handleExportSRT}>
								Export .SRT
							</Button>
						{/if}
					{/if}
				</div>

				{#if errorText}
					<div class="error">{errorText}</div>
				{/if}
			</div>

			<!-- Style Editor -->
			{#if captions.hasSegments}
				<div class="section">
					<button class="section-header" onclick={() => { showStyleEditor = !showStyleEditor; }}>
						<span>Caption Style</span>
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
							{#if showStyleEditor}
								<polyline points="18 15 12 9 6 15" />
							{:else}
								<polyline points="6 9 12 15 18 9" />
							{/if}
						</svg>
					</button>

					{#if showStyleEditor}
						<div class="style-grid">
							<Dropdown
								label="Font"
								value={fontFamily}
								options={fontOptions}
								onchange={(v) => { fontFamily = v; }}
							/>

							<Slider
								label="Size"
								bind:value={fontSize}
								min={16}
								max={48}
								step={1}
							/>

							<div class="color-row">
								<label class="color-label">Font Color</label>
								<input type="color" bind:value={fontColor} class="color-input" />
							</div>

							<div class="color-row">
								<label class="color-label">Background</label>
								<div class="bg-controls">
									<input type="color" bind:value={backgroundColor} class="color-input" disabled={bgTransparent} />
									<label class="checkbox-label">
										<input type="checkbox" bind:checked={bgTransparent} />
										None
									</label>
								</div>
							</div>

							<div class="radio-group">
								<span class="radio-label">Position</span>
								<div class="radio-options">
									{#each ['top', 'center', 'bottom'] as pos}
										<label class="radio-option">
											<input
												type="radio"
												name="caption-position"
												value={pos}
												checked={position === pos}
												onchange={() => { position = pos as CaptionStyle['position']; }}
											/>
											{pos}
										</label>
									{/each}
								</div>
							</div>

							<div class="radio-group">
								<span class="radio-label">Alignment</span>
								<div class="radio-options">
									{#each ['left', 'center', 'right'] as align}
										<label class="radio-option">
											<input
												type="radio"
												name="caption-alignment"
												value={align}
												checked={alignment === align}
												onchange={() => { alignment = align as CaptionStyle['alignment']; }}
											/>
											{align}
										</label>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Segment List -->
			{#if captions.hasSegments}
				<div class="section">
					<div class="section-title">Segments ({captions.captionTrack.segments.length})</div>
					<div class="segment-list">
						{#each captions.captionTrack.segments as segment (segment.id)}
							<div class="segment-item">
								<span class="segment-time">
									{formatTime(segment.startTime)} - {formatTime(segment.endTime)}
								</span>
								<span
									class="segment-text"
									contenteditable="true"
									role="textbox"
									tabindex="0"
									onblur={(e) => handleSegmentEdit(segment.id, e)}
								>{segment.text}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</Modal>

<style>
	.caption-dialog {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.unsupported {
		text-align: center;
		padding: 20px;
	}

	.unsupported p {
		color: var(--text-secondary);
		font-size: 13px;
		margin-bottom: 8px;
	}

	.unsupported .hint {
		color: var(--text-muted);
		font-size: 12px;
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

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}

	.section-header:hover {
		color: var(--text-secondary);
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

	.transcribing {
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
		background: #ff4444;
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

	.style-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 4px;
	}

	.color-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.color-label {
		font-size: 11px;
		color: var(--text-tertiary);
		min-width: 80px;
	}

	.color-input {
		width: 28px;
		height: 28px;
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		padding: 0;
		cursor: pointer;
		background: none;
	}

	.color-input:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.bg-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.radio-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.radio-label {
		font-size: 11px;
		color: var(--text-tertiary);
		min-width: 80px;
	}

	.radio-options {
		display: flex;
		gap: 12px;
	}

	.radio-option {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-secondary);
		cursor: pointer;
		text-transform: capitalize;
	}

	.segment-list {
		max-height: 200px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		padding: 4px;
	}

	.segment-item {
		display: flex;
		gap: 10px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		align-items: baseline;
	}

	.segment-item:hover {
		background: var(--bg-hover);
	}

	.segment-time {
		flex-shrink: 0;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-muted);
		min-width: 70px;
	}

	.segment-text {
		flex: 1;
		color: var(--text-primary);
		outline: none;
		border-radius: 2px;
		padding: 1px 4px;
		line-height: 1.4;
	}

	.segment-text:focus {
		background: var(--bg-surface, var(--bg-tertiary));
		box-shadow: 0 0 0 1px var(--border-focus);
	}
</style>
