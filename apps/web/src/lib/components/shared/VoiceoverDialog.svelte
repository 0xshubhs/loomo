<script lang="ts">
	import { getTimeline, getMediaLibrary, getUI, getPlayback } from '$lib/state/context.js';
	import {
		isTTSSupported,
		getAvailableVoices,
		speakPreview,
		stopPreview,
		synthesizeToAudio,
		DEFAULT_TTS_OPTIONS,
		type VoiceGroup,
		type TTSOptions,
	} from '$lib/engine/text-to-speech.js';
	import { generateId } from '$lib/utils/id.js';
	import {
		DEFAULT_CLIP_FILTERS,
		DEFAULT_TRANSFORM,
		DEFAULT_CROP,
		DEFAULT_CHROMA_KEY,
		DEFAULT_CLIP_POSITION,
	} from '$lib/types/index.js';
	import type { Clip } from '$lib/types/index.js';
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Slider from './Slider.svelte';

	const timeline = getTimeline();
	const mediaLibrary = getMediaLibrary();
	const ui = getUI();
	const playback = getPlayback();

	const isSupported = isTTSSupported();

	let scriptText = $state('');
	let voiceGroups = $state<VoiceGroup[]>([]);
	let selectedVoiceURI = $state('');
	let rate = $state(DEFAULT_TTS_OPTIONS.rate);
	let pitch = $state(DEFAULT_TTS_OPTIONS.pitch);
	let volume = $state(DEFAULT_TTS_OPTIONS.volume);
	let isPreviewing = $state(false);
	let isGenerating = $state(false);
	let statusText = $state('');
	let errorText = $state('');

	onMount(async () => {
		if (isSupported) {
			voiceGroups = await getAvailableVoices();
			if (voiceGroups.length > 0 && voiceGroups[0].voices.length > 0) {
				// Select the first default voice, or the first voice available
				const defaultVoice = voiceGroups
					.flatMap((g) => g.voices)
					.find((v) => v.default);
				selectedVoiceURI = defaultVoice?.voiceURI ?? voiceGroups[0].voices[0].voiceURI;
			}
		}
	});

	function getSelectedVoice(): SpeechSynthesisVoice | null {
		if (!selectedVoiceURI) return null;
		for (const group of voiceGroups) {
			for (const voice of group.voices) {
				if (voice.voiceURI === selectedVoiceURI) return voice;
			}
		}
		return null;
	}

	function getTTSOptions(): TTSOptions {
		return {
			voice: getSelectedVoice(),
			rate,
			pitch,
			volume,
		};
	}

	function handlePreview() {
		if (!scriptText.trim()) {
			errorText = 'Please enter some text first.';
			return;
		}
		errorText = '';
		isPreviewing = true;

		const utterance = speakPreview(scriptText, getTTSOptions());
		utterance.onend = () => {
			isPreviewing = false;
		};
		utterance.onerror = () => {
			isPreviewing = false;
		};
	}

	function handleStopPreview() {
		stopPreview();
		isPreviewing = false;
	}

	async function handleGenerate() {
		if (!scriptText.trim()) {
			errorText = 'Please enter some text first.';
			return;
		}

		errorText = '';
		isGenerating = true;
		statusText = 'Starting synthesis...';

		try {
			const { blob, duration } = await synthesizeToAudio(
				scriptText,
				getTTSOptions(),
				(status) => { statusText = status; },
			);

			if (blob.size === 0) {
				throw new Error('Generated audio is empty. This may be a browser limitation.');
			}

			statusText = 'Adding to timeline...';

			// Create a File from the blob
			const fileName = `voiceover-${Date.now()}.webm`;
			const file = new File([blob], fileName, { type: blob.type });
			const blobUrl = URL.createObjectURL(blob);
			const assetId = generateId();

			// Add as a media asset
			mediaLibrary.addAsset({
				id: assetId,
				name: fileName,
				file,
				blobUrl,
				type: 'audio',
				metadata: {
					duration,
					width: 0,
					height: 0,
					fps: 0,
					codec: '',
					audioCodec: 'opus',
					bitrate: 0,
					fileSize: blob.size,
					format: 'webm',
				},
				thumbnails: [],
				waveform: null,
				addedAt: Date.now(),
			});

			// Find or create an audio track
			let audioTrack = timeline.tracks.find((t) => t.type === 'audio');
			if (!audioTrack) {
				audioTrack = timeline.addTrack('audio', 'Voiceover');
			}

			// Create the audio clip
			const clipId = generateId();
			const clip: Clip = {
				id: clipId,
				name: 'Voiceover',
				type: 'audio',
				assetId,
				trackId: audioTrack.id,
				timelineStart: playback.currentTime,
				duration,
				sourceStart: 0,
				sourceEnd: duration,
				volume: 1,
				muted: false,
				speed: 1,
				opacity: 1,
				filters: { ...DEFAULT_CLIP_FILTERS },
				filterPreset: null,
				transform: { ...DEFAULT_TRANSFORM },
				crop: { ...DEFAULT_CROP },
				fadeIn: 0,
				fadeOut: 0,
				noiseSuppression: false,
				chromaKey: { ...DEFAULT_CHROMA_KEY },
				reversed: false,
				position: { ...DEFAULT_CLIP_POSITION },
				groupId: null,
			};

			audioTrack.clips.push(clip);
			timeline.tracks = [...timeline.tracks];

			statusText = '';
			ui.showVoiceoverDialog = false;
		} catch (err: any) {
			errorText = err.message || 'Failed to generate voiceover.';
		} finally {
			isGenerating = false;
			statusText = '';
		}
	}

	function handleClose() {
		stopPreview();
		ui.showVoiceoverDialog = false;
	}
</script>

<Modal bind:open={ui.showVoiceoverDialog} title="AI Voiceover" onclose={handleClose}>
	{#if !isSupported}
		<div class="unsupported">
			<p>Web Speech API is not supported in this browser.</p>
			<p class="hint">Please use Google Chrome or Microsoft Edge for text-to-speech voiceover.</p>
		</div>
	{:else}
		<div class="voiceover-dialog">
			<!-- Script Input -->
			<div class="section">
				<label class="section-title" for="voiceover-script">Script</label>
				<textarea
					id="voiceover-script"
					class="script-input"
					bind:value={scriptText}
					placeholder="Enter the text you want to convert to speech..."
					rows="5"
					disabled={isGenerating}
				></textarea>
				<span class="char-count">{scriptText.length} characters</span>
			</div>

			<!-- Voice Selection -->
			<div class="section">
				<label class="section-title" for="voice-select">Voice</label>
				<select
					id="voice-select"
					class="voice-select"
					bind:value={selectedVoiceURI}
					disabled={isGenerating}
				>
					{#each voiceGroups as group}
						<optgroup label={group.language}>
							{#each group.voices as voice}
								<option value={voice.voiceURI}>
									{voice.name} ({voice.lang}){voice.default ? ' - Default' : ''}
								</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>

			<!-- Speed & Pitch Controls -->
			<div class="section">
				<div class="controls-grid">
					<Slider
						label="Speed"
						bind:value={rate}
						min={0.5}
						max={2}
						step={0.1}
					/>
					<Slider
						label="Pitch"
						bind:value={pitch}
						min={0}
						max={2}
						step={0.1}
					/>
					<Slider
						label="Volume"
						bind:value={volume}
						min={0}
						max={1}
						step={0.1}
					/>
				</div>
			</div>

			<!-- Actions -->
			<div class="section">
				<div class="actions">
					{#if isGenerating}
						<div class="generating">
							<div class="pulse-dot"></div>
							<span class="status">{statusText || 'Generating...'}</span>
						</div>
					{:else}
						{#if isPreviewing}
							<Button variant="ghost" size="sm" onclick={handleStopPreview}>
								Stop Preview
							</Button>
						{:else}
							<Button variant="ghost" size="sm" onclick={handlePreview} disabled={!scriptText.trim()}>
								Preview
							</Button>
						{/if}
						<Button
							variant="primary"
							size="sm"
							onclick={handleGenerate}
							disabled={!scriptText.trim()}
						>
							Generate & Add to Timeline
						</Button>
					{/if}
				</div>

				{#if errorText}
					<div class="error">{errorText}</div>
				{/if}

				<div class="browser-note">
					<p>Speech synthesis uses your browser's built-in voices. The voiceover will be spoken aloud during generation and recorded as an audio clip.</p>
				</div>
			</div>
		</div>
	{/if}
</Modal>

<style>
	.voiceover-dialog {
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
		gap: 8px;
	}

	.section-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.script-input {
		width: 100%;
		min-height: 100px;
		padding: 10px 12px;
		background: var(--bg-primary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 13px;
		font-family: inherit;
		line-height: 1.5;
		resize: vertical;
		outline: none;
		transition: border-color 0.15s;
	}

	.script-input:focus {
		border-color: var(--border-focus, var(--text-muted));
	}

	.script-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.script-input::placeholder {
		color: var(--text-muted);
	}

	.char-count {
		font-size: 10px;
		color: var(--text-muted);
		text-align: right;
	}

	.voice-select {
		width: 100%;
		padding: 6px 10px;
		background: var(--bg-primary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 12px;
		font-family: inherit;
		outline: none;
		cursor: pointer;
	}

	.voice-select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.controls-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.generating {
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

	.browser-note {
		margin-top: 4px;
	}

	.browser-note p {
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.4;
	}
</style>
