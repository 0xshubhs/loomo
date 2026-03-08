<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getTimeline, getPlayback, getUI, getSelection, getCommands, getMediaLibrary } from '$lib/state/context.js';
	import { TimelineRenderer } from '$lib/timeline/timeline-renderer.js';
	import { handleMouseDown, handleMouseMove, createDragState, getCursorForPosition, type DragState } from '$lib/timeline/interaction-handler.js';
	import { calculateZoom } from '$lib/timeline/zoom-controller.js';
	import { pixelToPlayhead } from '$lib/timeline/playhead-controller.js';
	import { MoveClipCommand, TrimClipCommand } from '$lib/commands/clip-commands.js';
	import { AddClipCommand } from '$lib/commands/clip-commands.js';
	import { getTrackIndexFromY } from '$lib/timeline/timeline-engine.js';
	import { generateId } from '$lib/utils/id.js';
	import type { Clip } from '$lib/types/index.js';

	const timeline = getTimeline();
	const playback = getPlayback();
	const ui = getUI();
	const selection = getSelection();
	const commands = getCommands();
	const mediaLibrary = getMediaLibrary();

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
			pixelsPerSecond: ui.pixelsPerSecond,
			scrollX: ui.timelineScrollX,
			scrollY: ui.timelineScrollY,
			currentTime: playback.currentTime,
			selectedClipIds: selection.selectedClipIds,
			selectedTransitionId: selection.selectedTransitionId,
			duration: timeline.totalDuration,
			snapLine: dragState.snapTime,
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
			return;
		}

		dragState = handleMouseMove(e, dragState, timeline.tracks, ui.pixelsPerSecond, ui.timelineScrollX, ui.snapEnabled);

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
				const newStart = dragState.snapTime ?? dragState.startTime + deltaTime;
				commands.execute(new MoveClipCommand(timeline, dragState.clipId, newStart));
			}
		} else if ((dragState.mode === 'trim-start' || dragState.mode === 'trim-end') && dragState.clipId) {
			const deltaX = dragState.currentX - dragState.startX;
			const deltaTime = deltaX / ui.pixelsPerSecond;
			if (Math.abs(deltaTime) > 0.01) {
				const edge = dragState.mode === 'trim-start' ? 'start' : 'end';
				commands.execute(new TrimClipCommand(timeline, dragState.clipId, edge, deltaTime));
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

		const clip: Clip = {
			id: generateId(),
			name: asset.name,
			type: asset.type === 'image' ? 'image' : asset.type === 'audio' ? 'audio' : 'video',
			assetId: asset.id,
			trackId: targetTrack.id,
			timelineStart: dropTime,
			duration: asset.metadata.duration,
			sourceStart: 0,
			sourceEnd: asset.metadata.duration,
			volume: 1,
			muted: false,
			speed: 1,
			opacity: 1,
		};

		commands.execute(new AddClipCommand(timeline, targetTrack.id, clip));

		if (asset.thumbnails.length > 0) {
			renderer.loadThumbnail(asset.id, asset.thumbnails[0]);
		}

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
	onmouseleave={() => { if (dragState.mode !== 'none') onMouseUp(new MouseEvent('mouseup')); }}
	onwheel={onWheel}
	ondrop={onDrop}
	ondragover={onDragOver}
	class="timeline-canvas"
></canvas>

<style>
	.timeline-canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
