<script lang="ts">
	import type { Annotation, AnnotationToolState, AnnotationType } from '$lib/types/annotations.js';
	import { ANNOTATION_TOOLS } from '$lib/types/annotations.js';
	import { getTimeline, getCommands, getPlayback } from '$lib/state/context.js';
	import {
		RemoveAnnotationCommand,
		UpdateAnnotationCommand,
		ClearAnnotationsCommand,
	} from '$lib/commands/annotation-commands.js';
	import { isAnnotationVisible } from '$lib/utils/annotation-render.js';
	import { formatDuration } from '$lib/utils/time.js';

	interface Props {
		/** Shared with AnnotationLayer; editing it here arms the drawing surface. */
		tools: AnnotationToolState;
		selectedId?: string | null;
		onselect?: (id: string | null) => void;
	}

	let { tools, selectedId = null, onselect }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();

	const SWATCHES = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#ffffff', '#000000'];

	let annotations = $derived(timeline.annotations);

	function toggleTool(type: AnnotationType): void {
		// Clicking the armed tool disarms it, which is also how the preview
		// gets its pointer events back.
		tools.tool = tools.tool === type ? null : type;
	}

	function update(id: string, updates: Partial<Omit<Annotation, 'id'>>): void {
		commands.execute(new UpdateAnnotationCommand(timeline, id, updates));
	}

	function remove(id: string): void {
		commands.execute(new RemoveAnnotationCommand(timeline, id));
		if (selectedId === id) onselect?.(null);
	}

	function clearAll(): void {
		commands.execute(new ClearAnnotationsCommand(timeline));
		onselect?.(null);
	}

	function labelFor(annotation: Annotation): string {
		return ANNOTATION_TOOLS.find((t) => t.type === annotation.type)?.label ?? annotation.type;
	}

	/** Re-times an annotation to start under the playhead, keeping its length. */
	function moveToPlayhead(annotation: Annotation): void {
		const length = Math.max(0.1, annotation.endTime - annotation.startTime);
		update(annotation.id, {
			startTime: playback.currentTime,
			endTime: playback.currentTime + length,
		});
	}
</script>

<div class="annotations">
	<div class="section-header">
		<h4>Annotations</h4>
		{#if annotations.length > 0}
			<button class="remove-btn" onclick={clearAll}>Clear all</button>
		{/if}
	</div>

	<div class="tools">
		{#each ANNOTATION_TOOLS as tool (tool.type)}
			<button
				class="tool"
				class:on={tools.tool === tool.type}
				onclick={() => toggleTool(tool.type)}
				title={`Draw with the ${tool.label.toLowerCase()}`}
			>
				{tool.label}
			</button>
		{/each}
	</div>

	<p class="hint">
		{#if tools.tool}
			Drag on the preview to draw. Tap an existing mark to select it.
		{:else}
			Pick a tool to draw on the preview.
		{/if}
	</p>

	<div class="prop-section">
		<span class="prop-label">Colour</span>
		<div class="swatch-row">
			{#each SWATCHES as swatch (swatch)}
				<button
					class="swatch"
					class:on={tools.color.toLowerCase() === swatch}
					style="background: {swatch};"
					aria-label={`Use ${swatch}`}
					onclick={() => (tools.color = swatch)}
				></button>
			{/each}
			<input
				type="color"
				value={tools.color}
				onchange={(e) => (tools.color = e.currentTarget.value)}
				class="color-input"
				aria-label="Custom colour"
			/>
		</div>
	</div>

	<div class="prop-section">
		<span class="prop-label">
			Width <em>{tools.strokeWidth}</em>
		</span>
		<input
			type="range"
			min="1"
			max="40"
			step="1"
			value={tools.strokeWidth}
			oninput={(e) => (tools.strokeWidth = Number(e.currentTarget.value))}
		/>
	</div>

	<div class="prop-section">
		<span class="prop-label">
			Duration <em>{tools.duration.toFixed(1)}s</em>
		</span>
		<input
			type="range"
			min="0.5"
			max="15"
			step="0.5"
			value={tools.duration}
			oninput={(e) => (tools.duration = Number(e.currentTarget.value))}
		/>
	</div>

	{#if annotations.length === 0}
		<p class="empty">Nothing drawn yet.</p>
	{:else}
		<ul class="list">
			{#each annotations as annotation (annotation.id)}
				<li
					class="row"
					class:selected={selectedId === annotation.id}
					class:live={isAnnotationVisible(annotation, playback.currentTime)}
				>
					<button class="row-main" onclick={() => onselect?.(annotation.id)}>
						<span class="dot" style="background: {annotation.color};"></span>
						<span class="row-label">{labelFor(annotation)}</span>
						<span class="row-time">
							{formatDuration(annotation.startTime)}–{formatDuration(annotation.endTime)}
						</span>
					</button>
					<button
						class="icon-btn"
						onclick={() => moveToPlayhead(annotation)}
						title="Move to playhead"
						aria-label="Move to playhead">⇥</button
					>
					<button
						class="icon-btn danger"
						onclick={() => remove(annotation.id)}
						title="Delete"
						aria-label="Delete annotation">×</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.annotations h4 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin: 0;
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

	.tools {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
	}

	.tool {
		font-size: 10px;
		padding: 5px 4px;
		cursor: pointer;
		background: var(--bg-hover);
		color: var(--text-secondary);
		border: 1px solid transparent;
		border-radius: 4px;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}

	.tool:hover {
		color: var(--text-primary);
	}

	.tool.on {
		background: rgba(255, 59, 48, 0.15);
		color: #ff6b60;
		border-color: rgba(255, 59, 48, 0.4);
	}

	.hint {
		font-size: 10px;
		color: var(--text-tertiary);
		margin: 6px 0 0;
		line-height: 1.4;
	}

	.prop-section {
		margin-top: 10px;
	}

	.prop-label {
		font-size: 11px;
		color: var(--text-tertiary);
		display: flex;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.prop-label em {
		font-style: normal;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.prop-section input[type='range'] {
		width: 100%;
		accent-color: #ff3b30;
	}

	.swatch-row {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 1px solid var(--bg-hover);
		padding: 0;
		cursor: pointer;
	}

	.swatch.on {
		border-color: var(--text-primary);
	}

	.color-input {
		width: 28px;
		height: 20px;
		border: 1px solid var(--bg-hover);
		border-radius: 4px;
		padding: 0;
		cursor: pointer;
		background: transparent;
	}

	.empty {
		font-size: 10px;
		color: var(--text-tertiary);
		margin: 10px 0 0;
	}

	.list {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 2px;
		border-top: 1px solid var(--border-primary);
	}

	.row.selected {
		background: var(--bg-hover);
	}

	.row-main {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		padding: 5px 2px;
		cursor: pointer;
		text-align: left;
		min-width: 0;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.row-label {
		font-size: 11px;
		color: var(--text-tertiary);
		flex: 1;
	}

	/* Annotations under the playhead are the ones the preview is showing. */
	.row.live .row-label {
		color: var(--text-primary);
	}

	.row-time {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.icon-btn {
		background: none;
		border: none;
		color: var(--text-tertiary);
		font-size: 13px;
		line-height: 1;
		padding: 2px 4px;
		cursor: pointer;
	}

	.icon-btn:hover {
		color: var(--text-primary);
	}

	.icon-btn.danger:hover {
		color: #f87171;
	}
</style>
