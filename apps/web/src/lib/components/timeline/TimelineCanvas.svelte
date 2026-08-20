<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getTimeline, getPlayback, getUI, getSelection, getCommands, getMediaLibrary, getProject } from '$lib/state/context.js';
	import { TimelineRenderer } from '$lib/timeline/timeline-renderer.js';
	import { handleMouseDown, handleMouseMove, createDragState, getCursorForPosition, type DragState } from '$lib/timeline/interaction-handler.js';
	import { calculateZoom } from '$lib/timeline/zoom-controller.js';
	import { pixelToPlayhead } from '$lib/timeline/playhead-controller.js';
	import { MoveClipCommand, TrimClipCommand } from '$lib/commands/clip-commands.js';
	import {
		AddClipCommand,
		RemoveClipCommand,
		SplitClipCommand,
		DuplicateClipsCommand,
		RemoveGapsCommand,
		CloseGapCommand,
		TrimToPlayheadCommand,
	} from '$lib/commands/clip-commands.js';
	import { DetachAudioCommand } from '$lib/commands/audio-commands.js';
	import { gapAt, clipAt } from '$lib/timeline/gaps.js';
	import ContextMenu, { type MenuEntry } from '../shared/ContextMenu.svelte';
	import { formatDuration } from '$lib/utils/time.js';
	import { getTrackIndexFromY } from '$lib/timeline/timeline-engine.js';
	import { generateId } from '$lib/utils/id.js';
	import { addMarker, removeMarker, renameMarker, markerAt } from '$lib/timeline/markers.js';
	import { clampMoveDelta, clampTrimDelta, isMeaningfulDelta } from '$lib/timeline/clip-bounds.js';
	import type { Clip, Marker } from '$lib/types/index.js';
	import { createClip } from '$lib/types/timeline.js';

	const timeline = getTimeline();
	const playback = getPlayback();
	const ui = getUI();
	const project = getProject();
	const selection = getSelection();
	const commands = getCommands();
	const mediaLibrary = getMediaLibrary();

	let contextMenu = $state<{ x: number; y: number; items: MenuEntry[] } | null>(null);
	let hoveredClipId: string | null = null;
	let renamingMarker = $state<{ id: string; value: string } | null>(null);

	let canvasEl: HTMLCanvasElement;
	let renderer: TimelineRenderer;
	let dragState: DragState = createDragState();

	onMount(() => {
		renderer = new TimelineRenderer(canvasEl);
		renderer.startRenderLoop();
		updateRenderer();

		const resizeObs = new ResizeObserver(() => {
			renderer.resize();
			updateRenderer();
		});
		resizeObs.observe(canvasEl);

		return () => {
			resizeObs.disconnect();
		};
	});

	onDestroy(() => {
		renderer?.destroy();
	});

	// Reactively update renderer when state changes
	$effect(() => {
		updateRenderer();
	});

	function updateRenderer() {
		if (!renderer) return;
		renderer.update({
			tracks: timeline.tracks,
			transitions: timeline.transitions,
			textOverlays: timeline.textOverlays,
			shapeOverlays: timeline.shapeOverlays,
			pixelsPerSecond: ui.pixelsPerSecond,
			scrollX: ui.timelineScrollX,
			scrollY: ui.timelineScrollY,
			currentTime: playback.currentTime,
			selectedClipIds: selection.selectedClipIds,
			selectedTransitionId: selection.selectedTransitionId,
			duration: timeline.totalDuration,
			snapLine: dragState.snapTime,
			hoveredClipId,
			markers: timeline.markers,
		});
	}

	function onMouseDown(e: MouseEvent) {
		dragState = handleMouseDown(
			e, timeline.tracks, ui.pixelsPerSecond,
			ui.timelineScrollX, ui.timelineScrollY,
			renderer.trackHeight, renderer.trackGap, renderer.rulerHeight,
			playback.currentTime
		);

		if (dragState.mode === 'playhead') {
			playback.seek(dragState.startTime);
		} else if (dragState.clipId) {
			selection.selectClip(dragState.clipId, e.shiftKey);
			// Auto-select all clips in the same group
			const clickedClip = timeline.getClipById(dragState.clipId);
			if (clickedClip?.groupId && !e.shiftKey) {
				const groupClips = timeline.getGroupClips(clickedClip.groupId);
				for (const gc of groupClips) {
					if (gc.id !== dragState.clipId) {
						selection.selectClip(gc.id, true);
					}
				}
			}
		} else if (dragState.mode === 'select') {
			selection.deselectAll();
		}

		updateRenderer();
	}

	function onMouseMove(e: MouseEvent) {
		if (dragState.mode === 'none') {
			// Update cursor
			const rect = canvasEl.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			canvasEl.style.cursor = getCursorForPosition(
				timeline.tracks, x, y, ui.pixelsPerSecond,
				ui.timelineScrollX, ui.timelineScrollY,
				renderer.trackHeight, renderer.trackGap, renderer.rulerHeight
			);

			// Surface the trim handles for whatever the cursor is over.
			const time = Math.max(0, (x + ui.timelineScrollX) / ui.pixelsPerSecond);
			const trackIndex = getTrackIndexFromY(
				y, renderer.trackHeight, renderer.trackGap, renderer.rulerHeight,
				ui.timelineScrollY, timeline.tracks.length
			);
			const track = timeline.tracks[trackIndex];
			const nextHovered = track ? (clipAt(track, time)?.id ?? null) : null;
			if (nextHovered !== hoveredClipId) {
				hoveredClipId = nextHovered;
				updateRenderer();
			}
			return;
		}

		dragState = handleMouseMove(
			e, dragState, timeline.tracks, ui.pixelsPerSecond,
			ui.timelineScrollX, ui.snapEnabled, undefined, timeline.markers
		);

		if (dragState.mode === 'playhead') {
			const rect = canvasEl.getBoundingClientRect();
			playback.seek(pixelToPlayhead(e.clientX - rect.left, ui.pixelsPerSecond, ui.timelineScrollX));
		}

		updateRenderer();
	}

	function onMouseUp(e: MouseEvent) {
		if (dragState.mode === 'move' && dragState.clipId) {
			const deltaX = dragState.currentX - dragState.startX;
			const deltaTime = deltaX / ui.pixelsPerSecond;
			if (Math.abs(deltaTime) > 0.01) {
				const movedClip = timeline.getClipById(dragState.clipId);
				const requested = (dragState.snapTime ?? dragState.startTime + deltaTime) - dragState.startTime;

				// Everything moving has to be clamped together. Clamping each
				// clip on its own would stop the leftmost at zero and let the
				// rest keep sliding, which tears a group apart.
				const moving = movedClip?.groupId
					? timeline.getGroupClips(movedClip.groupId)
					: movedClip
						? [movedClip]
						: [];
				const delta = clampMoveDelta(requested, moving.map((c) => c.timelineStart));

				if (isMeaningfulDelta(delta)) {
					commands.execute(
						new MoveClipCommand(timeline, dragState.clipId, dragState.startTime + delta)
					);
					for (const gc of moving) {
						if (gc.id !== dragState.clipId) {
							commands.execute(new MoveClipCommand(timeline, gc.id, gc.timelineStart + delta));
						}
					}
				}
			}
		} else if ((dragState.mode === 'trim-start' || dragState.mode === 'trim-end') && dragState.clipId) {
			const deltaX = dragState.currentX - dragState.startX;
			const deltaTime = deltaX / ui.pixelsPerSecond;
			if (Math.abs(deltaTime) > 0.01) {
				const edge = dragState.mode === 'trim-start' ? 'start' : 'end';
				const trimmed = timeline.getClipById(dragState.clipId);
				// The source's own length bounds the end handle; without it a
				// clip can be stretched past the last frame it has.
				const sourceDuration = trimmed
					? mediaLibrary.getAssetById(trimmed.assetId)?.metadata.duration
					: undefined;

				if (trimmed && isMeaningfulDelta(clampTrimDelta(trimmed, edge, deltaTime, { sourceDuration }))) {
					commands.execute(
						new TrimClipCommand(timeline, dragState.clipId, edge, deltaTime, { sourceDuration })
					);
				}
			}
		}

		dragState = createDragState();
		updateRenderer();
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const rect = canvasEl.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const result = calculateZoom(ui.timelineZoom, e.deltaY, mouseX, ui.timelineScrollX);
			ui.timelineZoom = result.zoom;
			ui.timelineScrollX = result.scrollX;
		} else {
			ui.timelineScrollX = Math.max(0, ui.timelineScrollX + e.deltaX + e.deltaY);
		}
		updateRenderer();
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		const assetId = e.dataTransfer?.getData('application/x-media-asset');
		if (!assetId) return;

		const asset = mediaLibrary.getAssetById(assetId);
		if (!asset) return;

		const rect = canvasEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const dropTime = Math.max(0, (x + ui.timelineScrollX) / ui.pixelsPerSecond);
		const trackIndex = getTrackIndexFromY(y, renderer.trackHeight, renderer.trackGap, renderer.rulerHeight, ui.timelineScrollY, timeline.tracks.length);

		let targetTrack = timeline.tracks[trackIndex];
		if (!targetTrack) {
			targetTrack = timeline.addTrack(asset.type === 'audio' ? 'audio' : 'video');
		}

		const clip: Clip = createClip({
			id: generateId(),
			name: asset.name,
			type: asset.type === 'image' ? 'image' : asset.type === 'audio' ? 'audio' : 'video',
			assetId: asset.id,
			trackId: targetTrack.id,
			timelineStart: dropTime,
			duration: asset.metadata.duration,
		});

		commands.execute(new AddClipCommand(timeline, targetTrack.id, clip));

		if (asset.thumbnails.length > 0) {
			renderer.loadThumbnail(asset.id, asset.thumbnails[0]);
		}

		updateRenderer();
	}

	/**
	 * How near a click has to be to count as landing on a marker.
	 *
	 * Derived from the zoom so the target stays the same size on screen at
	 * every scale.
	 */
	function markerTolerance(): number {
		return 6 / Math.max(1, ui.pixelsPerSecond);
	}

	/**
	 * Opens the inline rename box over a marker.
	 *
	 * Inline rather than `prompt()`: a native modal dialog freezes the whole
	 * WebKitGTK webview until it is dismissed, which on this platform has
	 * meant a wedged window more than once.
	 */
	function startRenamingMarker(marker: Marker) {
		renamingMarker = { id: marker.id, value: marker.label };
	}

	function commitMarkerRename() {
		if (!renamingMarker) return;
		const { id, value } = renamingMarker;
		renamingMarker = null;
		if (!value.trim()) return;

		timeline.markers = renameMarker(timeline.markers, id, value.trim());
		project.markDirty();
		updateRenderer();
	}

	/** Where the rename box sits, following the marker as the timeline scrolls. */
	let renameLeft = $derived.by(() => {
		const marker = timeline.markers.find((m) => m.id === renamingMarker?.id);
		if (!marker) return 0;
		return marker.time * ui.pixelsPerSecond - ui.timelineScrollX;
	});

	/**
	 * Builds the right-click menu for whatever is under the cursor: a clip, a
	 * gap between clips, or empty track space.
	 */
	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		const rect = canvasEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const time = Math.max(0, (x + ui.timelineScrollX) / ui.pixelsPerSecond);
		const trackIndex = getTrackIndexFromY(
			y, renderer.trackHeight, renderer.trackGap, renderer.rulerHeight,
			ui.timelineScrollY, timeline.tracks.length
		);
		const track = timeline.tracks[trackIndex];
		const items: MenuEntry[] = [];

		// The ruler is where markers live, so that is where they are managed.
		if (y < renderer.rulerHeight) {
			const existing = markerAt(timeline.markers, time, markerTolerance());

			if (existing) {
				items.push(
					{ label: `Go to "${existing.label}"`, action: () => playback.seek(existing.time) },
					{ label: 'Rename marker…', action: () => startRenamingMarker(existing) },
					'separator',
					{
						label: 'Remove marker',
						danger: true,
						action: () => {
							timeline.markers = removeMarker(timeline.markers, existing.id);
							project.markDirty();
							updateRenderer();
						},
					}
				);
			} else {
				items.push({
					label: 'Add marker here',
					shortcut: 'M',
					action: () => {
						timeline.markers = addMarker(timeline.markers, time);
						project.markDirty();
						updateRenderer();
					},
				});
			}

			if (timeline.markers.length > 0) {
				items.push('separator', {
					label: `Clear all markers (${timeline.markers.length})`,
					danger: true,
					action: () => {
						timeline.markers = [];
						project.markDirty();
						updateRenderer();
					},
				});
			}

			contextMenu = { x: e.clientX, y: e.clientY, items };
			return;
		}

		if (track) {
			const clip = clipAt(track, time);
			const gap = gapAt(track, time);

			if (clip) {
				selection.selectClip(clip.id, false);
				const playhead = playback.currentTime;
				const insideClip =
					playhead > clip.timelineStart + 0.01 &&
					playhead < clip.timelineStart + clip.duration - 0.01;

				items.push(
					{
						label: 'Split at playhead',
						shortcut: 'S',
						disabled: !insideClip,
						action: () => commands.execute(new SplitClipCommand(timeline, clip.id, playhead)),
					},
					{
						label: 'Trim start to playhead',
						disabled: !insideClip,
						action: () =>
							commands.execute(new TrimToPlayheadCommand(timeline, clip.id, 'start', playhead)),
					},
					{
						label: 'Trim end to playhead',
						disabled: !insideClip,
						action: () =>
							commands.execute(new TrimToPlayheadCommand(timeline, clip.id, 'end', playhead)),
					},
					'separator',
					{
						label: 'Duplicate',
						shortcut: 'Ctrl+D',
						action: () => commands.execute(new DuplicateClipsCommand(timeline, [clip.id])),
					},
				);

				if (clip.type === 'video') {
					items.push({
						label: 'Detach audio',
						action: () => commands.execute(new DetachAudioCommand(timeline, clip.id)),
					});
				}

				items.push('separator', {
					label: 'Delete clip',
					shortcut: 'Del',
					danger: true,
					action: () => commands.execute(new RemoveClipCommand(timeline, clip.id)),
				});
			} else if (gap) {
				items.push(
					{
						label: `Close this gap (${formatDuration(gap.end - gap.start)})`,
						action: () =>
							commands.execute(new CloseGapCommand(timeline, track.id, gap.start, gap.end)),
					},
					{
						label: 'Close all gaps on this track',
						action: () => commands.execute(new RemoveGapsCommand(timeline, track.id)),
					},
					{
						label: 'Close all gaps',
						shortcut: 'G',
						action: () => commands.execute(new RemoveGapsCommand(timeline)),
					}
				);
			} else {
				items.push({
					label: 'Close all gaps',
					shortcut: 'G',
					action: () => commands.execute(new RemoveGapsCommand(timeline)),
				});
			}
		} else {
			items.push(
				{ label: 'Add video track', action: () => timeline.addTrack('video') },
				{ label: 'Add audio track', action: () => timeline.addTrack('audio') }
			);
		}

		contextMenu = { x: e.clientX, y: e.clientY, items };
		updateRenderer();
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}
</script>

<canvas
	bind:this={canvasEl}
	onmousedown={onMouseDown}
	onmousemove={onMouseMove}
	onmouseup={onMouseUp}
	onmouseleave={() => {
		if (dragState.mode !== 'none') onMouseUp(new MouseEvent('mouseup'));
		if (hoveredClipId !== null) { hoveredClipId = null; updateRenderer(); }
	}}
	onwheel={onWheel}
	ondrop={onDrop}
	ondragover={onDragOver}
	oncontextmenu={onContextMenu}
	class="timeline-canvas"
></canvas>

{#if renamingMarker}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		class="marker-rename"
		style="left: {renameLeft}px"
		bind:value={renamingMarker.value}
		autofocus
		onblur={commitMarkerRename}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Enter') commitMarkerRename();
			if (e.key === 'Escape') renamingMarker = null;
		}}
	/>
{/if}

{#if contextMenu}
	<ContextMenu
		x={contextMenu.x}
		y={contextMenu.y}
		items={contextMenu.items}
		onclose={() => (contextMenu = null)}
	/>
{/if}

<style>
	.timeline-canvas {
		width: 100%;
		height: 100%;
		display: block;
	}

	.marker-rename {
		position: absolute;
		top: 4px;
		width: 120px;
		padding: 1px 4px;
		border: 1px solid var(--accent-primary, #ff5f45);
		border-radius: 3px;
		background: #000;
		color: var(--text-primary, #fff);
		font-size: 10px;
		z-index: 20;
	}
</style>
