<script lang="ts">
	import type { TextOverlay } from '$lib/types/index.js';
	import { getTimeline, getCommands } from '$lib/state/context.js';
	import { UpdateTextOverlayCommand, RemoveTextOverlayCommand } from '$lib/commands/text-commands.js';
	import Slider from '../shared/Slider.svelte';
	import Button from '../shared/Button.svelte';

	interface Props {
		overlay: TextOverlay;
	}

	let { overlay }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();

	function updateField(field: keyof TextOverlay, value: any) {
		commands.execute(new UpdateTextOverlayCommand(timeline, overlay.id, { [field]: value }));
	}

	function removeOverlay() {
		commands.execute(new RemoveTextOverlayCommand(timeline, overlay.id));
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
</style>
