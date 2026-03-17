<script lang="ts">
	import type { ShapeOverlay } from '$lib/types/index.js';
	import { getTimeline, getCommands, getSelection } from '$lib/state/context.js';
	import { UpdateShapeOverlayCommand, RemoveShapeOverlayCommand } from '$lib/commands/shape-commands.js';
	import { getShapeById } from '$lib/utils/shapes.js';
	import Slider from '../shared/Slider.svelte';

	interface Props {
		overlay: ShapeOverlay;
	}

	let { overlay }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();
	const selection = getSelection();

	let shapeDef = $derived(getShapeById(overlay.shapeId));

	function update(updates: Partial<ShapeOverlay>) {
		commands.execute(new UpdateShapeOverlayCommand(timeline, overlay.id, updates));
	}

	function handleRemove() {
		commands.execute(new RemoveShapeOverlayCommand(timeline, overlay.id));
		selection.deselectAll();
	}
</script>

<div class="shape-properties">
	<div class="section-header">
		<h4>Shape</h4>
		<button class="remove-btn" onclick={handleRemove}>Remove</button>
	</div>

	{#if shapeDef}
		<div class="shape-preview-row">
			<svg viewBox={shapeDef.viewBox} class="shape-thumb">
				<path d={shapeDef.path} fill={overlay.fillColor} stroke={overlay.strokeColor} stroke-width={overlay.strokeWidth > 0 ? overlay.strokeWidth : 0} />
			</svg>
			<span class="shape-label">{shapeDef.name}</span>
		</div>
	{/if}

	<div class="prop-section">
		<span class="prop-label color-label">Fill Color</span>
		<input
			type="color"
			value={overlay.fillColor}
			onchange={(e) => update({ fillColor: e.currentTarget.value })}
			class="color-input"
		/>
	</div>

	<div class="prop-section">
		<span class="prop-label color-label">Stroke Color</span>
		<div class="stroke-row">
			<input
				type="color"
				value={overlay.strokeColor}
				onchange={(e) => update({ strokeColor: e.currentTarget.value })}
				class="color-input"
			/>
			<input
				type="number"
				min="0"
				max="20"
				step="0.5"
				value={overlay.strokeWidth}
				onchange={(e) => update({ strokeWidth: Number(e.currentTarget.value) })}
				class="num-input"
				title="Stroke width"
			/>
		</div>
	</div>

	<div class="prop-section">
		<Slider
			label="Opacity"
			value={Math.round(overlay.opacity * 100)}
			min={0}
			max={100}
			step={1}
			oninput={(v) => update({ opacity: v / 100 })}
		/>
	</div>

	<div class="prop-section">
		<span class="prop-label">Size</span>
		<div class="size-row">
			<div class="size-input">
				<label for="shape-w">W</label>
				<input
					id="shape-w"
					type="number"
					min="10"
					max="2000"
					value={overlay.width}
					onchange={(e) => update({ width: Number(e.currentTarget.value) })}
				/>
			</div>
			<div class="size-input">
				<label for="shape-h">H</label>
				<input
					id="shape-h"
					type="number"
					min="10"
					max="2000"
					value={overlay.height}
					onchange={(e) => update({ height: Number(e.currentTarget.value) })}
				/>
			</div>
		</div>
	</div>

	<div class="prop-section">
		<Slider
			label="Rotation"
			value={overlay.rotation}
			min={0}
			max={360}
			step={1}
			oninput={(v) => update({ rotation: v })}
		/>
	</div>

	<div class="prop-section">
		<span class="prop-label">Position (%)</span>
		<div class="size-row">
			<div class="size-input">
				<label for="shape-x">X</label>
				<input
					id="shape-x"
					type="number"
					min="0"
					max="100"
					value={Math.round(overlay.x)}
					onchange={(e) => update({ x: Number(e.currentTarget.value) })}
				/>
			</div>
			<div class="size-input">
				<label for="shape-y">Y</label>
				<input
					id="shape-y"
					type="number"
					min="0"
					max="100"
					value={Math.round(overlay.y)}
					onchange={(e) => update({ y: Number(e.currentTarget.value) })}
				/>
			</div>
		</div>
	</div>

	<div class="prop-section">
		<span class="prop-label">Timing</span>
		<div class="size-row">
			<div class="size-input">
				<label for="shape-start">Start</label>
				<input
					id="shape-start"
					type="number"
					min="0"
					step="0.1"
					value={overlay.startTime.toFixed(1)}
					onchange={(e) => update({ startTime: Number(e.currentTarget.value) })}
				/>
			</div>
			<div class="size-input">
				<label for="shape-dur">Dur</label>
				<input
					id="shape-dur"
					type="number"
					min="0.1"
					step="0.1"
					value={overlay.duration.toFixed(1)}
					onchange={(e) => update({ duration: Number(e.currentTarget.value) })}
				/>
			</div>
		</div>
	</div>
</div>

<style>
	.shape-properties h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.remove-btn {
		font-size: 10px;
		color: #f87171;
		background: var(--bg-hover);
		border: none;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.remove-btn:hover {
		color: #fca5a5;
		background: var(--bg-active);
	}

	.shape-preview-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}

	.shape-thumb {
		width: 28px;
		height: 28px;
	}

	.shape-label {
		font-size: 11px;
		color: var(--text-secondary);
	}

	.prop-section {
		margin-top: 8px;
	}

	.prop-label {
		font-size: 11px;
		color: var(--text-tertiary);
		display: block;
		margin-bottom: 4px;
	}

	.color-label {
		margin-bottom: 4px;
	}

	.color-input {
		width: 32px;
		height: 24px;
		border: 1px solid var(--bg-hover);
		border-radius: 4px;
		padding: 0;
		cursor: pointer;
		background: transparent;
	}

	.stroke-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.num-input {
		width: 56px;
		height: 24px;
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

	.num-input:focus {
		border-color: var(--accent);
	}

	.size-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}

	.size-input {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.size-input label {
		font-size: 10px;
		color: var(--text-tertiary);
		width: 28px;
		flex-shrink: 0;
	}

	.size-input input {
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

	.size-input input:focus {
		border-color: var(--accent);
	}
</style>
