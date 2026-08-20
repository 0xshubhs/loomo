<script lang="ts">
	import { getTimeline, getSelection, getCommands, getPlayback } from '$lib/state/context.js';
	import { UpdateMosaicCommand } from '$lib/commands/keyframe-commands.js';
	import {
		regionAt,
		resizeRegion,
		handleAt,
		cursorFor,
		type DragHandle,
	} from '$lib/utils/mosaic-drag.js';
	import type { MosaicRegion } from '$lib/types/timeline.js';

	/**
	 * Mosaic regions, drawn over the preview and draggable.
	 *
	 * They were four sliders each — nudging numbers while looking at the face
	 * you are trying to cover. This layer only appears while the mosaic panel
	 * has a clip selected, and stays `pointer-events: none` otherwise, so it
	 * cannot swallow clicks meant for the frame underneath.
	 *
	 * A drag is committed as one `UpdateMosaicCommand` on release rather than
	 * one per pointer move: the intermediate positions are not edits anyone
	 * wants to undo through.
	 */

	interface Props {
		/** Only shown when the properties panel is on the mosaic tool. */
		active: boolean;
	}

	let { active }: Props = $props();

	const timeline = getTimeline();
	const selection = getSelection();
	const commands = getCommands();
	const playback = getPlayback();

	let host: HTMLDivElement;
	let hoverHandle = $state<DragHandle | null>(null);
	/** Live position during a drag, so the box follows without committing. */
	let dragging = $state<{ id: string; handle: DragHandle; from: MosaicRegion; box: MosaicRegion } | null>(null);

	const clip = $derived.by(() => {
		for (const id of selection.selectedClipIds) {
			const found = timeline.getClipById(id);
			if (found) return found;
		}
		return null;
	});

	/** Regions on the selected clip that are showing at the playhead. */
	const regions = $derived.by(() => {
		if (!clip?.mosaics?.length) return [] as MosaicRegion[];
		const at = playback.currentTime - clip.timelineStart;
		return clip.mosaics.filter(
			(m) => (m.startTime === null || at >= m.startTime) && (m.endTime === null || at <= m.endTime)
		);
	});

	/** Where a pointer event falls, as a percentage of the frame. */
	function toPercent(e: PointerEvent): { x: number; y: number } {
		const rect = host.getBoundingClientRect();
		return {
			x: ((e.clientX - rect.left) / rect.width) * 100,
			y: ((e.clientY - rect.top) / rect.height) * 100,
		};
	}

	function onPointerDown(e: PointerEvent) {
		if (!active || !clip) return;
		const at = toPercent(e);
		const hit = regionAt(regions, at.x, at.y);
		if (!hit) return;

		e.preventDefault();
		host.setPointerCapture(e.pointerId);
		dragging = { id: hit.region.id, handle: hit.handle, from: { ...hit.region }, box: { ...hit.region } };
	}

	function onPointerMove(e: PointerEvent) {
		if (!active) return;
		const at = toPercent(e);

		if (!dragging) {
			hoverHandle = regionAt(regions, at.x, at.y)?.handle ?? null;
			return;
		}

		const rect = host.getBoundingClientRect();
		const start = dragging.from;
		// Measured from where the drag began rather than accumulated per move,
		// so a fast pointer cannot drift away from the cursor.
		const originX = ((e.clientX - rect.left) / rect.width) * 100;
		const originY = ((e.clientY - rect.top) / rect.height) * 100;
		const anchor = handleAnchor(start, dragging.handle);
		const resized = resizeRegion(start, dragging.handle, originX - anchor.x, originY - anchor.y);
		dragging = { ...dragging, box: { ...start, ...resized } };
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging || !clip) return;
		host.releasePointerCapture(e.pointerId);

		const { id, from, box } = dragging;
		dragging = null;
		// Nothing moved: a click that selected a region is not an edit.
		if (box.x === from.x && box.y === from.y && box.width === from.width && box.height === from.height) return;

		commands.execute(
			new UpdateMosaicCommand(timeline, clip.id, id, {
				x: box.x, y: box.y, width: box.width, height: box.height,
			})
		);
	}

	/** The point a handle is measured from, so the drag tracks the cursor. */
	function handleAnchor(region: MosaicRegion, handle: DragHandle): { x: number; y: number } {
		if (handle === 'move') return { x: region.x, y: region.y };
		return {
			x: handle.includes('w') ? region.x : handle.includes('e') ? region.x + region.width : region.x,
			y: handle.includes('n') ? region.y : handle.includes('s') ? region.y + region.height : region.y,
		};
	}

	/** The box to draw: the live drag position when there is one. */
	function shown(region: MosaicRegion): MosaicRegion {
		return dragging?.id === region.id ? dragging.box : region;
	}
</script>

<div
	class="mosaic-layer"
	class:active
	bind:this={host}
	style="cursor: {cursorFor(dragging?.handle ?? hoverHandle)}"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={() => (dragging = null)}
>
	{#each regions as region (region.id)}
		{@const b = shown(region)}
		<div
			class="region"
			class:dragging={dragging?.id === region.id}
			style="left: {b.x}%; top: {b.y}%; width: {b.width}%; height: {b.height}%"
		>
			<span class="label">{region.mode === 'blur' ? 'Blur' : 'Pixelate'}</span>
		</div>
	{/each}
</div>

<style>
	.mosaic-layer {
		position: absolute;
		inset: 0;
		/* Inert unless the mosaic tool is open, so it cannot swallow a click
		   meant for the frame or the annotation layer above it. */
		pointer-events: none;
		z-index: 6;
	}

	.mosaic-layer.active {
		pointer-events: auto;
	}

	.region {
		position: absolute;
		border: 1px solid var(--accent-primary, #ff5f45);
		background: rgba(255, 95, 69, 0.12);
		box-sizing: border-box;
	}

	.region.dragging {
		background: rgba(255, 95, 69, 0.22);
	}

	.label {
		position: absolute;
		top: -16px;
		left: 0;
		padding: 0 4px;
		border-radius: 3px;
		background: var(--accent-primary, #ff5f45);
		color: #fff;
		font-size: 9px;
		white-space: nowrap;
	}
</style>
