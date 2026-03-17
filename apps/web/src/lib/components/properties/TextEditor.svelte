<script lang="ts">
	import type { TextOverlay, TextShadow, TextOutline, TextAnimation } from '$lib/types/index.js';
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import {
		UpdateTextOverlayCommand,
		RemoveTextOverlayCommand,
		SetTextFontCommand,
		SetTextShadowCommand,
		SetTextOutlineCommand,
		SetTextAnimationCommand,
	} from '$lib/commands/text-commands.js';
	import { FONT_LIST, loadGoogleFont, GOOGLE_FONTS } from '$lib/utils/fonts.js';
	import Slider from '../shared/Slider.svelte';
	import Button from '../shared/Button.svelte';
	import { onMount } from 'svelte';

	interface Props {
		overlay: TextOverlay;
	}

	let { overlay }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();

	onMount(() => {
		// Preload Google Fonts so previews render correctly
		for (const font of GOOGLE_FONTS) {
			loadGoogleFont(font.value);
		}
	});

	function updateField(field: keyof TextOverlay, value: any) {
		commands.execute(new UpdateTextOverlayCommand(timeline, overlay.id, { [field]: value }));
	}

	function removeOverlay() {
		commands.execute(new RemoveTextOverlayCommand(timeline, overlay.id));
	}

	function setFont(fontFamily: string) {
		loadGoogleFont(fontFamily);
		commands.execute(new SetTextFontCommand(timeline, overlay.id, fontFamily));
	}

	function updateShadow(updates: Partial<TextShadow>) {
		const shadow: TextShadow = { ...overlay.shadow, ...updates };
		commands.execute(new SetTextShadowCommand(timeline, overlay.id, shadow));
	}

	function updateOutline(updates: Partial<TextOutline>) {
		const outline: TextOutline = { ...overlay.outline, ...updates };
		commands.execute(new SetTextOutlineCommand(timeline, overlay.id, outline));
	}

	function setAnimation(animation: TextAnimation) {
		commands.execute(new SetTextAnimationCommand(timeline, overlay.id, animation));
	}
</script>

<div class="text-editor">
	<h4>Text Overlay</h4>

	<div class="field">
		<label>Text</label>
		<textarea
			value={overlay.text}
			oninput={(e) => updateField('text', (e.target as HTMLTextAreaElement).value)}
			rows="3"
		></textarea>
	</div>

	<div class="field">
		<label>Font Family</label>
		<select
			value={overlay.fontFamily}
			onchange={(e) => setFont((e.target as HTMLSelectElement).value)}
			class="font-select"
		>
			{#each FONT_LIST as font}
				<option value={font.value} style="font-family: '{font.value}'">
					{font.name}
				</option>
			{/each}
		</select>
		<div class="font-preview" style="font-family: '{overlay.fontFamily}'">
			{overlay.fontFamily}
		</div>
	</div>

	<div class="field">
		<label>Font Size</label>
		<Slider value={overlay.fontSize} min={12} max={200} step={1} oninput={(v) => updateField('fontSize', v)} />
	</div>

	<div class="field">
		<label>Font Weight</label>
		<select value={String(overlay.fontWeight)} onchange={(e) => updateField('fontWeight', parseInt((e.target as HTMLSelectElement).value))}>
			<option value="400">Regular</option>
			<option value="500">Medium</option>
			<option value="700">Bold</option>
			<option value="900">Black</option>
		</select>
	</div>

	<div class="field-row">
		<div class="field">
			<label>Color</label>
			<input type="color" value={overlay.color} oninput={(e) => updateField('color', (e.target as HTMLInputElement).value)} />
		</div>
		<div class="field">
			<label>Background</label>
			<input type="color" value={overlay.backgroundColor === 'transparent' ? '#000000' : overlay.backgroundColor} oninput={(e) => updateField('backgroundColor', (e.target as HTMLInputElement).value)} />
		</div>
	</div>

	<div class="field">
		<label>Position X</label>
		<Slider value={Math.round(overlay.x * 100)} min={0} max={100} step={1} oninput={(v) => updateField('x', v / 100)} />
	</div>

	<div class="field">
		<label>Position Y</label>
		<Slider value={Math.round(overlay.y * 100)} min={0} max={100} step={1} oninput={(v) => updateField('y', v / 100)} />
	</div>

	<div class="field">
		<label>Opacity</label>
		<Slider value={Math.round(overlay.opacity * 100)} min={0} max={100} step={1} oninput={(v) => updateField('opacity', v / 100)} />
	</div>

	<div class="field">
		<label>Alignment</label>
		<div class="align-buttons">
			<button class:active={overlay.alignment === 'left'} onclick={() => updateField('alignment', 'left')}>L</button>
			<button class:active={overlay.alignment === 'center'} onclick={() => updateField('alignment', 'center')}>C</button>
			<button class:active={overlay.alignment === 'right'} onclick={() => updateField('alignment', 'right')}>R</button>
		</div>
	</div>

	<div class="field">
		<label>Letter Spacing ({overlay.letterSpacing ?? 0}px)</label>
		<Slider value={overlay.letterSpacing ?? 0} min={-5} max={20} step={0.5} oninput={(v) => updateField('letterSpacing', v)} />
	</div>

	<div class="field">
		<label>Line Height ({overlay.lineHeight ?? 1.2})</label>
		<Slider value={overlay.lineHeight ?? 1.2} min={0.5} max={3} step={0.1} oninput={(v) => updateField('lineHeight', v)} />
	</div>

	<!-- Shadow Section -->
	<div class="section">
		<div class="section-header">
			<label>Shadow</label>
			<label class="toggle">
				<input
					type="checkbox"
					checked={overlay.shadow?.enabled ?? false}
					onchange={(e) => updateShadow({ enabled: (e.target as HTMLInputElement).checked })}
				/>
				<span class="toggle-label">{overlay.shadow?.enabled ? 'On' : 'Off'}</span>
			</label>
		</div>
		{#if overlay.shadow?.enabled}
			<div class="section-body">
				<div class="field">
					<label>Shadow Color</label>
					<input
						type="color"
						value={overlay.shadow.color}
						oninput={(e) => updateShadow({ color: (e.target as HTMLInputElement).value })}
					/>
				</div>
				<div class="field">
					<label>Offset X ({overlay.shadow.offsetX})</label>
					<Slider
						value={overlay.shadow.offsetX}
						min={-20}
						max={20}
						step={1}
						oninput={(v) => updateShadow({ offsetX: v })}
					/>
				</div>
				<div class="field">
					<label>Offset Y ({overlay.shadow.offsetY})</label>
					<Slider
						value={overlay.shadow.offsetY}
						min={-20}
						max={20}
						step={1}
						oninput={(v) => updateShadow({ offsetY: v })}
					/>
				</div>
				<div class="field">
					<label>Blur ({overlay.shadow.blur})</label>
					<Slider
						value={overlay.shadow.blur}
						min={0}
						max={20}
						step={1}
						oninput={(v) => updateShadow({ blur: v })}
					/>
				</div>
			</div>
		{/if}
	</div>

	<!-- Outline Section -->
	<div class="section">
		<div class="section-header">
			<label>Outline</label>
			<label class="toggle">
				<input
					type="checkbox"
					checked={overlay.outline?.enabled ?? false}
					onchange={(e) => updateOutline({ enabled: (e.target as HTMLInputElement).checked })}
				/>
				<span class="toggle-label">{overlay.outline?.enabled ? 'On' : 'Off'}</span>
			</label>
		</div>
		{#if overlay.outline?.enabled}
			<div class="section-body">
				<div class="field">
					<label>Outline Color</label>
					<input
						type="color"
						value={overlay.outline.color}
						oninput={(e) => updateOutline({ color: (e.target as HTMLInputElement).value })}
					/>
				</div>
				<div class="field">
					<label>Width ({overlay.outline.width})</label>
					<Slider
						value={overlay.outline.width}
						min={1}
						max={10}
						step={1}
						oninput={(v) => updateOutline({ width: v })}
					/>
				</div>
			</div>
		{/if}
	</div>

	<!-- Animation Section -->
	<div class="field">
		<label>Animation</label>
		<select
			value={overlay.animation ?? 'none'}
			onchange={(e) => setAnimation((e.target as HTMLSelectElement).value as TextAnimation)}
		>
			<option value="none">None</option>
			<option value="fadeIn">Fade In</option>
			<option value="slideUp">Slide Up</option>
			<option value="slideDown">Slide Down</option>
			<option value="slideLeft">Slide Left</option>
			<option value="slideRight">Slide Right</option>
			<option value="scaleIn">Scale In</option>
			<option value="typewriter">Typewriter</option>
		</select>
	</div>

	<Button variant="danger" size="sm" onclick={removeOverlay}>Remove Text</Button>
</div>

<style>
	.text-editor h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 8px;
	}

	.field {
		margin-bottom: 8px;
	}

	.field label {
		display: block;
		font-size: 10px;
		color: var(--text-tertiary);
		margin-bottom: 3px;
	}

	.field textarea, .field select {
		width: 100%;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		padding: 4px 8px;
		color: var(--text-primary);
		font-size: 12px;
		resize: vertical;
	}

	.field textarea:focus, .field select:focus {
		border-color: var(--border-focus);
		outline: none;
	}

	.field input[type="color"] {
		width: 32px;
		height: 24px;
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		background: none;
		cursor: pointer;
		padding: 0;
	}

	.font-select {
		margin-bottom: 4px;
	}

	.font-preview {
		font-size: 14px;
		color: var(--text-primary);
		padding: 4px 8px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		text-align: center;
	}

	.field-row {
		display: flex;
		gap: 12px;
	}

	.align-buttons {
		display: flex;
		gap: 2px;
	}

	.align-buttons button {
		width: 28px;
		height: 24px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 700;
		cursor: pointer;
	}

	.align-buttons button.active {
		background: var(--bg-active);
		border-color: var(--text-tertiary);
		color: var(--text-primary);
	}

	.section {
		margin-bottom: 8px;
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px;
		background: var(--bg-surface);
	}

	.section-header label {
		font-size: 10px;
		color: var(--text-tertiary);
		margin: 0;
	}

	.section-body {
		padding: 8px;
		border-top: 1px solid var(--border-primary);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}

	.toggle input[type="checkbox"] {
		width: 14px;
		height: 14px;
		cursor: pointer;
	}

	.toggle-label {
		font-size: 10px;
		color: var(--text-secondary);
	}
</style>
