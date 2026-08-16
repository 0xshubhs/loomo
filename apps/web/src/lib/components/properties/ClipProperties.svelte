<script lang="ts">
	import type { Clip } from '$lib/types/index.js';
	import type { RotationAngle } from '$lib/types/timeline.js';
	import { DEFAULT_CLIP_FILTERS, DEFAULT_TRANSFORM, DEFAULT_CROP, DEFAULT_CHROMA_KEY, DEFAULT_CLIP_POSITION } from '$lib/types/timeline.js';
	import type { ChromaKey } from '$lib/types/timeline.js';
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import { SetVolumeCommand, SetClipFadeInCommand, SetClipFadeOutCommand, SetNoiseSuppressionCommand, DetachAudioCommand } from '$lib/commands/audio-commands.js';
	import { SetClipFiltersCommand, SetClipTransformCommand, SetClipCropCommand, SetChromaKeyCommand, SetClipReversedCommand, SetClipPositionCommand, SetVideoEffectCommand } from '$lib/commands/clip-commands.js';
	import { VIDEO_EFFECT_LIST, type VideoEffectType } from '$lib/types/effects.js';
	import { formatDuration } from '$lib/utils/time.js';
	import { FILTER_PRESETS, applyPreset, hasNonDefaultFilters } from '$lib/utils/filter-presets.js';
	import { PIP_PRESETS, presetToPosition, hasNonDefaultPosition } from '$lib/utils/pip-presets.js';
	import Slider from '../shared/Slider.svelte';

	interface Props {
		clip: Clip;
	}

	let { clip }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();

	function handleVolumeChange(value: number) {
		commands.execute(new SetVolumeCommand(timeline, clip.id, value / 100));
	}

	function handleFadeInChange(value: number) {
		commands.execute(new SetClipFadeInCommand(timeline, clip.id, value));
	}

	function handleFadeOutChange(value: number) {
		commands.execute(new SetClipFadeOutCommand(timeline, clip.id, value));
	}

	function handleNoiseSuppressionToggle() {
		commands.execute(new SetNoiseSuppressionCommand(timeline, clip.id, !clip.noiseSuppression));
	}

	function handleDetachAudio() {
		commands.execute(new DetachAudioCommand(timeline, clip.id));
	}

	function handlePresetClick(presetName: string) {
		const newFilters = applyPreset(presetName);
		const preset = presetName === 'none' ? null : presetName;
		commands.execute(new SetClipFiltersCommand(timeline, clip.id, newFilters, preset));
	}

	function handleFilterChange(key: keyof typeof DEFAULT_CLIP_FILTERS, value: number) {
		const newFilters = { ...clip.filters, [key]: value };
		commands.execute(new SetClipFiltersCommand(timeline, clip.id, newFilters, null));
	}

	function handleResetFilters() {
		commands.execute(new SetClipFiltersCommand(timeline, clip.id, { ...DEFAULT_CLIP_FILTERS }, null));
	}

	function handleRotate(delta: number) {
		const current = clip.transform?.rotation ?? 0;
		const newRotation = (((current + delta) % 360) + 360) % 360 as RotationAngle;
		commands.execute(new SetClipTransformCommand(timeline, clip.id, {
			...(clip.transform ?? { ...DEFAULT_TRANSFORM }),
			rotation: newRotation,
		}));
	}

	function handleFlipH() {
		const t = clip.transform ?? { ...DEFAULT_TRANSFORM };
		commands.execute(new SetClipTransformCommand(timeline, clip.id, {
			...t,
			flipH: !t.flipH,
		}));
	}

	function handleFlipV() {
		const t = clip.transform ?? { ...DEFAULT_TRANSFORM };
		commands.execute(new SetClipTransformCommand(timeline, clip.id, {
			...t,
			flipV: !t.flipV,
		}));
	}

	function handleCropChange(side: 'top' | 'right' | 'bottom' | 'left', value: number) {
		const clamped = Math.max(0, Math.min(100, value));
		const newCrop = { ...(clip.crop ?? { ...DEFAULT_CROP }), [side]: clamped };
		commands.execute(new SetClipCropCommand(timeline, clip.id, newCrop));
	}

	function handleResetTransform() {
		commands.execute(new SetClipTransformCommand(timeline, clip.id, { ...DEFAULT_TRANSFORM }));
		commands.execute(new SetClipCropCommand(timeline, clip.id, { ...DEFAULT_CROP }));
	}

	function handleChromaKeyToggle() {
		const current = clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY };
		commands.execute(new SetChromaKeyCommand(timeline, clip.id, {
			...current,
			enabled: !current.enabled,
		}));
	}

	function handleChromaKeyColorPreset(color: 'green' | 'blue' | 'red') {
		const current = clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY };
		commands.execute(new SetChromaKeyCommand(timeline, clip.id, {
			...current,
			color,
		}));
	}

	function handleChromaKeyCustomColor(hex: string) {
		const current = clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY };
		commands.execute(new SetChromaKeyCommand(timeline, clip.id, {
			...current,
			color: hex,
		}));
	}

	function handleChromaKeyThreshold(value: number) {
		const current = clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY };
		commands.execute(new SetChromaKeyCommand(timeline, clip.id, {
			...current,
			threshold: value,
		}));
	}

	function handleChromaKeySmoothing(value: number) {
		const current = clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY };
		commands.execute(new SetChromaKeyCommand(timeline, clip.id, {
			...current,
			smoothing: value,
		}));
	}

	function handleResetChromaKey() {
		commands.execute(new SetChromaKeyCommand(timeline, clip.id, { ...DEFAULT_CHROMA_KEY }));
	}

	function handleReversedToggle() {
		commands.execute(new SetClipReversedCommand(timeline, clip.id, !clip.reversed));
	}

	function handlePipPresetClick(presetId: string) {
		const preset = PIP_PRESETS.find((p) => p.id === presetId);
		if (!preset) return;
		const pos = presetToPosition(preset, clip.position?.zIndex ?? 0);
		commands.execute(new SetClipPositionCommand(timeline, clip.id, pos));
	}

	function handlePositionChange(key: 'x' | 'y' | 'width' | 'height' | 'zIndex', value: number) {
		const current = clip.position ?? { ...DEFAULT_CLIP_POSITION };
		const clamped = key === 'zIndex' ? Math.max(0, Math.round(value)) : Math.max(0, Math.min(100, value));
		commands.execute(new SetClipPositionCommand(timeline, clip.id, { ...current, [key]: clamped }));
	}

	function handleResetPosition() {
		commands.execute(new SetClipPositionCommand(timeline, clip.id, { ...DEFAULT_CLIP_POSITION }));
	}

	let showChromaKey = $derived(clip.type === 'video');
	let showAudio = $derived(clip.type === 'video' || clip.type === 'audio');
	let showDetachAudio = $derived(clip.type === 'video');

	let hasTransformChanges = $derived(() => {
		const t = clip.transform;
		const c = clip.crop;
		if (!t && !c) return false;
		if (t && (t.rotation !== 0 || t.flipH || t.flipV)) return true;
		if (c && (c.top !== 0 || c.right !== 0 || c.bottom !== 0 || c.left !== 0)) return true;
		return false;
	});

	let showFilters = $derived(clip.type === 'video' || clip.type === 'image');
	let showTransform = $derived(clip.type === 'video' || clip.type === 'image');
	let showPosition = $derived(clip.type === 'video' || clip.type === 'image');
	let showEffects = $derived(clip.type === 'video');

	function handleVideoEffectClick(effectType: VideoEffectType) {
		const intensity = clip.videoEffect?.intensity ?? 50;
		commands.execute(new SetVideoEffectCommand(timeline, clip.id, { type: effectType, intensity }));
	}

	function handleVideoEffectIntensity(value: number) {
		const effectType = clip.videoEffect?.type ?? 'none';
		commands.execute(new SetVideoEffectCommand(timeline, clip.id, { type: effectType, intensity: value }));
	}
</script>

<div class="clip-properties">
	<h4>Clip</h4>
	<div class="prop-row">
		<span class="prop-label">Name</span>
		<span class="prop-value">{clip.name}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Type</span>
		<span class="prop-value">{clip.type}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Start</span>
		<span class="prop-value">{formatDuration(clip.timelineStart)}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Duration</span>
		<span class="prop-value">{formatDuration(clip.duration)}</span>
	</div>
	<div class="prop-row">
		<span class="prop-label">Source</span>
		<span class="prop-value">{formatDuration(clip.sourceStart)} - {formatDuration(clip.sourceEnd)}</span>
	</div>

	<div class="prop-section">
		<Slider
			label="Volume"
			value={Math.round(clip.volume * 100)}
			min={0}
			max={200}
			step={1}
			oninput={handleVolumeChange}
		/>
	</div>

	<div class="prop-section">
		<Slider
			label="Speed"
			value={clip.speed}
			min={0.1}
			max={16}
			step={0.1}
		/>
		{#if clip.type === 'video'}
			<div class="reverse-row">
				<span class="prop-label">Reverse</span>
				<button
					class="toggle-btn"
					class:active={clip.reversed}
					onclick={handleReversedToggle}
					title="Play clip in reverse"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="19 20 9 12 19 4 19 20"/>
						<line x1="5" y1="19" x2="5" y2="5"/>
					</svg>
					{clip.reversed ? 'ON' : 'OFF'}
				</button>
			</div>
		{/if}
	</div>

	<div class="prop-section">
		<Slider
			label="Opacity"
			value={Math.round(clip.opacity * 100)}
			min={0}
			max={100}
			step={1}
		/>
	</div>


	{#if showAudio}
		<div class="prop-section audio-section">
			<h4>Audio</h4>

			<Slider
				label="Fade In"
				value={clip.fadeIn ?? 0}
				min={0}
				max={5}
				step={0.1}
				oninput={handleFadeInChange}
			/>
			<div class="fade-preview">
				<svg class="fade-curve" viewBox="0 0 60 20" preserveAspectRatio="none">
					<path
						d="M0,20 L{Math.max(1, (clip.fadeIn ?? 0) / 5 * 60)},0 L60,0 L60,20 Z"
						fill="var(--accent)"
						opacity="0.2"
					/>
					<path
						d="M0,20 L{Math.max(1, (clip.fadeIn ?? 0) / 5 * 60)},0"
						fill="none"
						stroke="var(--accent)"
						stroke-width="1.5"
					/>
				</svg>
			</div>

			<Slider
				label="Fade Out"
				value={clip.fadeOut ?? 0}
				min={0}
				max={5}
				step={0.1}
				oninput={handleFadeOutChange}
			/>
			<div class="fade-preview">
				<svg class="fade-curve" viewBox="0 0 60 20" preserveAspectRatio="none">
					<path
						d="M0,0 L{60 - Math.max(1, (clip.fadeOut ?? 0) / 5 * 60)},0 L60,20 L0,20 Z"
						fill="var(--accent)"
						opacity="0.2"
					/>
					<path
						d="M{60 - Math.max(1, (clip.fadeOut ?? 0) / 5 * 60)},0 L60,20"
						fill="none"
						stroke="var(--accent)"
						stroke-width="1.5"
					/>
				</svg>
			</div>

			<div class="noise-toggle-row">
				<span class="prop-label">Noise Suppression</span>
				<button
					class="toggle-btn"
					class:active={clip.noiseSuppression}
					onclick={handleNoiseSuppressionToggle}
				>
					{clip.noiseSuppression ? 'ON' : 'OFF'}
				</button>
			</div>

			{#if showDetachAudio}
				<button class="detach-btn" onclick={handleDetachAudio}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M16 3l5 5-5 5"/><path d="M21 8H9"/>
						<path d="M8 21l-5-5 5-5"/><path d="M3 16h12"/>
					</svg>
					Detach Audio
				</button>
			{/if}
		</div>
	{/if}

	{#if showPosition}
		<div class="prop-section position-section">
			<div class="section-header">
				<h4>Position & Size</h4>
				{#if hasNonDefaultPosition(clip.position ?? DEFAULT_CLIP_POSITION)}
					<button class="reset-btn" onclick={handleResetPosition}>Reset to Full</button>
				{/if}
			</div>

			<div class="pip-preset-grid">
				{#each PIP_PRESETS as preset}
					<button
						class="pip-preset-btn"
						class:active={
							(clip.position?.x ?? 0) === preset.x &&
							(clip.position?.y ?? 0) === preset.y &&
							(clip.position?.width ?? 100) === preset.width &&
							(clip.position?.height ?? 100) === preset.height
						}
						onclick={() => handlePipPresetClick(preset.id)}
						title={preset.label}
					>
						<span class="pip-thumbnail">
							<span
								class="pip-rect"
								style="left: {preset.x}%; top: {preset.y}%; width: {preset.width}%; height: {preset.height}%;"
							></span>
						</span>
						<span class="pip-label">{preset.label}</span>
					</button>
				{/each}
			</div>

			<div class="position-grid">
				<div class="position-input">
					<label for="pos-x">X %</label>
					<input
						id="pos-x"
						type="number"
						min="0"
						max="100"
						value={clip.position?.x ?? 0}
						onchange={(e) => handlePositionChange('x', Number(e.currentTarget.value))}
					/>
				</div>
				<div class="position-input">
					<label for="pos-y">Y %</label>
					<input
						id="pos-y"
						type="number"
						min="0"
						max="100"
						value={clip.position?.y ?? 0}
						onchange={(e) => handlePositionChange('y', Number(e.currentTarget.value))}
					/>
				</div>
				<div class="position-input">
					<label for="pos-w">W %</label>
					<input
						id="pos-w"
						type="number"
						min="1"
						max="100"
						value={clip.position?.width ?? 100}
						onchange={(e) => handlePositionChange('width', Number(e.currentTarget.value))}
					/>
				</div>
				<div class="position-input">
					<label for="pos-h">H %</label>
					<input
						id="pos-h"
						type="number"
						min="1"
						max="100"
						value={clip.position?.height ?? 100}
						onchange={(e) => handlePositionChange('height', Number(e.currentTarget.value))}
					/>
				</div>
			</div>

			<div class="position-input zindex-row">
				<label for="pos-z">Z-Index</label>
				<input
					id="pos-z"
					type="number"
					min="0"
					max="100"
					value={clip.position?.zIndex ?? 0}
					onchange={(e) => handlePositionChange('zIndex', Number(e.currentTarget.value))}
				/>
			</div>
		</div>
	{/if}

	{#if showTransform}
		<div class="prop-section transform-section">
			<div class="section-header">
				<h4>Transform</h4>
				{#if hasTransformChanges()}
					<button class="reset-btn" onclick={handleResetTransform}>Reset</button>
				{/if}
			</div>

			<div class="transform-row">
				<span class="prop-label">Rotate</span>
				<div class="btn-group">
					<button class="icon-btn" title="Rotate 90° CCW" onclick={() => handleRotate(-90)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
						</svg>
					</button>
					<button class="icon-btn" title="Rotate 180°" onclick={() => handleRotate(180)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
							<path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
						</svg>
					</button>
					<button class="icon-btn" title="Rotate 90° CW" onclick={() => handleRotate(90)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
						</svg>
					</button>
				</div>
			</div>

			<div class="transform-row">
				<span class="prop-label">Flip</span>
				<div class="btn-group">
					<button
						class="icon-btn"
						class:active={clip.transform?.flipH}
						title="Flip Horizontal"
						onclick={handleFlipH}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 3v18"/><path d="M16 7l4 5-4 5"/><path d="M8 7L4 12l4 5"/>
						</svg>
					</button>
					<button
						class="icon-btn"
						class:active={clip.transform?.flipV}
						title="Flip Vertical"
						onclick={handleFlipV}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 12h18"/><path d="M7 8L12 4l5 4"/><path d="M7 16l5 4 5-4"/>
						</svg>
					</button>
				</div>
			</div>

			{#if clip.transform}
				<div class="transform-info">
					<span class="prop-label">Current</span>
					<span class="prop-value">
						{clip.transform.rotation}°{clip.transform.flipH ? ' FlipH' : ''}{clip.transform.flipV ? ' FlipV' : ''}
					</span>
				</div>
			{/if}

			<div class="crop-section">
				<span class="prop-label crop-heading">Crop (%)</span>
				<div class="crop-grid">
					<div class="crop-input">
						<label for="crop-top">Top</label>
						<input
							id="crop-top"
							type="number"
							min="0"
							max="100"
							value={clip.crop?.top ?? 0}
							onchange={(e) => handleCropChange('top', Number(e.currentTarget.value))}
						/>
					</div>
					<div class="crop-input">
						<label for="crop-right">Right</label>
						<input
							id="crop-right"
							type="number"
							min="0"
							max="100"
							value={clip.crop?.right ?? 0}
							onchange={(e) => handleCropChange('right', Number(e.currentTarget.value))}
						/>
					</div>
					<div class="crop-input">
						<label for="crop-bottom">Bottom</label>
						<input
							id="crop-bottom"
							type="number"
							min="0"
							max="100"
							value={clip.crop?.bottom ?? 0}
							onchange={(e) => handleCropChange('bottom', Number(e.currentTarget.value))}
						/>
					</div>
					<div class="crop-input">
						<label for="crop-left">Left</label>
						<input
							id="crop-left"
							type="number"
							min="0"
							max="100"
							value={clip.crop?.left ?? 0}
							onchange={(e) => handleCropChange('left', Number(e.currentTarget.value))}
						/>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if showFilters}
		<div class="prop-section filters-section">
			<div class="section-header">
				<h4>Filters</h4>
				{#if hasNonDefaultFilters(clip.filters)}
					<button class="reset-btn" onclick={handleResetFilters}>Reset</button>
				{/if}
			</div>

			<div class="preset-grid">
				{#each FILTER_PRESETS as preset}
					<button
						class="preset-btn"
						class:active={clip.filterPreset === preset.name || (preset.name === 'none' && clip.filterPreset === null && !hasNonDefaultFilters(clip.filters))}
						onclick={() => handlePresetClick(preset.name)}
					>
						<span class="preset-swatch" style="background: {preset.color};"></span>
						<span class="preset-name">{preset.label}</span>
					</button>
				{/each}
			</div>

			<div class="filter-sliders">
				<Slider
					label="Bright"
					value={clip.filters.brightness}
					min={0}
					max={200}
					step={1}
					oninput={(v) => handleFilterChange('brightness', v)}
				/>
				<Slider
					label="Contrast"
					value={clip.filters.contrast}
					min={0}
					max={200}
					step={1}
					oninput={(v) => handleFilterChange('contrast', v)}
				/>
				<Slider
					label="Saturate"
					value={clip.filters.saturation}
					min={0}
					max={200}
					step={1}
					oninput={(v) => handleFilterChange('saturation', v)}
				/>
				<Slider
					label="Hue"
					value={clip.filters.hue}
					min={0}
					max={360}
					step={1}
					oninput={(v) => handleFilterChange('hue', v)}
				/>
				<Slider
					label="Blur"
					value={clip.filters.blur}
					min={0}
					max={20}
					step={0.5}
					oninput={(v) => handleFilterChange('blur', v)}
				/>
				<Slider
					label="Exposure"
					value={clip.filters.exposure}
					min={-100}
					max={100}
					step={1}
					oninput={(v) => handleFilterChange('exposure', v)}
				/>
				<Slider
					label="Temp"
					value={clip.filters.temperature}
					min={-100}
					max={100}
					step={1}
					oninput={(v) => handleFilterChange('temperature', v)}
				/>
			</div>
		</div>
	{/if}

	{#if showEffects}
		<div class="prop-section effects-section">
			<div class="section-header">
				<h4>Video Effects</h4>
				{#if clip.videoEffect?.type && clip.videoEffect.type !== 'none'}
					<button class="reset-btn" onclick={() => handleVideoEffectClick('none')}>Reset</button>
				{/if}
			</div>

			<div class="preset-grid">
				{#each VIDEO_EFFECT_LIST as effect}
					<button
						class="preset-btn"
						class:active={clip.videoEffect?.type === effect.type || (effect.type === 'none' && (!clip.videoEffect || clip.videoEffect.type === 'none'))}
						onclick={() => handleVideoEffectClick(effect.type)}
					>
						<span class="preset-swatch" style="background: {effect.color};"></span>
						<span class="preset-name">{effect.label}</span>
					</button>
				{/each}
			</div>

			{#if clip.videoEffect?.type && clip.videoEffect.type !== 'none'}
				<Slider
					label="Intensity"
					value={clip.videoEffect.intensity}
					min={0}
					max={100}
					step={1}
					oninput={handleVideoEffectIntensity}
				/>
			{/if}
		</div>
	{/if}

	{#if showChromaKey}
		<div class="prop-section chroma-section">
			<div class="section-header">
				<h4>Chroma Key</h4>
				{#if clip.chromaKey?.enabled}
					<button class="reset-btn" onclick={handleResetChromaKey}>Reset</button>
				{/if}
			</div>

			<div class="chroma-toggle-row">
				<span class="prop-label">Enabled</span>
				<button
					class="toggle-btn"
					class:active={clip.chromaKey?.enabled}
					onclick={handleChromaKeyToggle}
				>
					{clip.chromaKey?.enabled ? 'ON' : 'OFF'}
				</button>
			</div>

			{#if clip.chromaKey?.enabled}
				<div class="chroma-color-row">
					<span class="prop-label">Key Color</span>
					<div class="chroma-color-btns">
						<button
							class="chroma-color-btn green"
							class:active={clip.chromaKey?.color === 'green'}
							onclick={() => handleChromaKeyColorPreset('green')}
							title="Green Screen"
						></button>
						<button
							class="chroma-color-btn blue"
							class:active={clip.chromaKey?.color === 'blue'}
							onclick={() => handleChromaKeyColorPreset('blue')}
							title="Blue Screen"
						></button>
						<button
							class="chroma-color-btn red"
							class:active={clip.chromaKey?.color === 'red'}
							onclick={() => handleChromaKeyColorPreset('red')}
							title="Red Screen"
						></button>
						<input
							type="color"
							class="chroma-color-picker"
							value={clip.chromaKey?.color === 'green' ? '#00B140' : clip.chromaKey?.color === 'blue' ? '#0000FF' : clip.chromaKey?.color === 'red' ? '#FF0000' : clip.chromaKey?.color ?? '#00B140'}
							oninput={(e) => handleChromaKeyCustomColor(e.currentTarget.value)}
							title="Custom Color"
						/>
					</div>
				</div>

				<Slider
					label="Threshold"
					value={clip.chromaKey?.threshold ?? 0.4}
					min={0}
					max={1}
					step={0.01}
					oninput={handleChromaKeyThreshold}
				/>
				<Slider
					label="Smoothing"
					value={clip.chromaKey?.smoothing ?? 0.1}
					min={0}
					max={0.5}
					step={0.01}
					oninput={handleChromaKeySmoothing}
				/>
			{/if}
		</div>
	{/if}
</div>

<style>
	.clip-properties h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 8px;
	}

	.prop-row {
		display: flex;
		justify-content: space-between;
		padding: 3px 0;
	}

	.prop-label {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.prop-value {
		font-size: 11px;
		color: var(--text-secondary);
		font-family: var(--font-mono);
	}

	.prop-section {
		margin-top: 8px;
	}


	.audio-section {
		border-top: 1px solid var(--bg-hover);
		padding-top: 8px;
	}

	.fade-preview {
		height: 20px;
		margin: 2px 0 6px;
	}

	.fade-curve {
		width: 100%;
		height: 100%;
	}

	.noise-toggle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 3px 0;
		margin-top: 4px;
		margin-bottom: 6px;
	}

	.detach-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 10px;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-secondary);
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
	}

	.detach-btn:hover {
		color: var(--text-primary);
		background: var(--bg-active);
		border-color: var(--accent);
	}

	.transform-section {
		border-top: 1px solid var(--bg-hover);
		padding-top: 8px;
	}

	.transform-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 3px 0;
	}

	.transform-info {
		display: flex;
		justify-content: space-between;
		padding: 3px 0;
	}

	.btn-group {
		display: flex;
		gap: 2px;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 24px;
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
	}

	.icon-btn:hover {
		background: var(--bg-active);
		color: var(--text-primary);
	}

	.icon-btn.active {
		border-color: var(--accent);
		background: var(--bg-active);
		color: var(--accent);
	}

	.crop-section {
		margin-top: 6px;
	}

	.crop-heading {
		display: block;
		margin-bottom: 4px;
	}

	.crop-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}

	.crop-input {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.crop-input label {
		font-size: 10px;
		color: var(--text-tertiary);
		width: 32px;
		flex-shrink: 0;
	}

	.crop-input input {
		width: 100%;
		height: 22px;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-secondary);
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 4px;
		padding: 0 4px;
		outline: none;
		transition: border-color 0.15s;
	}

	.crop-input input:focus {
		border-color: var(--accent);
	}

	.reverse-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 0 0;
	}

	.reverse-row .toggle-btn {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.effects-section {
		border-top: 1px solid var(--bg-hover);
		padding-top: 8px;
	}

	.filters-section {
		border-top: 1px solid var(--bg-hover);
		padding-top: 8px;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.section-header h4 {
		margin-bottom: 0;
	}

	.reset-btn {
		font-size: 10px;
		color: var(--text-tertiary);
		background: var(--bg-hover);
		border: none;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.reset-btn:hover {
		color: var(--text-primary);
		background: var(--bg-active);
	}

	.preset-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
		margin-bottom: 10px;
	}

	.preset-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 4px 2px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.preset-btn:hover {
		background: var(--bg-hover);
	}

	.preset-btn.active {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.preset-swatch {
		width: 24px;
		height: 16px;
		border-radius: 3px;
		display: block;
	}

	.preset-name {
		font-size: 9px;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.filter-sliders {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.chroma-section {
		border-top: 1px solid var(--bg-hover);
		padding-top: 8px;
	}

	.chroma-toggle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 3px 0;
		margin-bottom: 6px;
	}

	.toggle-btn {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 10px;
		border-radius: 4px;
		border: 1px solid transparent;
		background: var(--bg-hover);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
	}

	.toggle-btn:hover {
		background: var(--bg-active);
		color: var(--text-primary);
	}

	.toggle-btn.active {
		border-color: var(--accent);
		background: var(--bg-active);
		color: var(--accent);
	}

	.chroma-color-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 3px 0;
		margin-bottom: 6px;
	}

	.chroma-color-btns {
		display: flex;
		gap: 4px;
		align-items: center;
	}

	.chroma-color-btn {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		border: 2px solid transparent;
		cursor: pointer;
		transition: border-color 0.15s, transform 0.1s;
	}

	.chroma-color-btn:hover {
		transform: scale(1.1);
	}

	.chroma-color-btn.active {
		border-color: var(--accent);
	}

	.chroma-color-btn.green {
		background: #00B140;
	}

	.chroma-color-btn.blue {
		background: #0000FF;
	}

	.chroma-color-btn.red {
		background: #FF0000;
	}

	.chroma-color-picker {
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 4px;
		padding: 0;
		cursor: pointer;
		background: transparent;
	}

	.chroma-color-picker::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.chroma-color-picker::-webkit-color-swatch {
		border: 1px solid var(--bg-active);
		border-radius: 4px;
	}

	.position-section {
		border-top: 1px solid var(--bg-hover);
		padding-top: 8px;
	}

	.pip-preset-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 4px;
		margin-bottom: 10px;
	}

	.pip-preset-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 3px 2px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.pip-preset-btn:hover {
		background: var(--bg-hover);
	}

	.pip-preset-btn.active {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.pip-thumbnail {
		position: relative;
		width: 28px;
		height: 20px;
		background: var(--bg-hover);
		border-radius: 2px;
		overflow: hidden;
	}

	.pip-rect {
		position: absolute;
		background: var(--accent);
		opacity: 0.6;
		border-radius: 1px;
	}

	.pip-label {
		font-size: 7px;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.position-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin-bottom: 4px;
	}

	.position-input {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.position-input label {
		font-size: 10px;
		color: var(--text-tertiary);
		width: 28px;
		flex-shrink: 0;
	}

	.position-input input {
		width: 100%;
		height: 22px;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--text-secondary);
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 4px;
		padding: 0 4px;
		outline: none;
		transition: border-color 0.15s;
	}

	.position-input input:focus {
		border-color: var(--accent);
	}

	.zindex-row {
		margin-top: 4px;
	}

	.zindex-row label {
		width: 48px;
	}

	.zindex-row input {
		max-width: 60px;
	}
</style>
