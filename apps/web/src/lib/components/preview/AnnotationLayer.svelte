<script lang="ts">
	import { onMount } from 'svelte';
	import type { Annotation, AnnotationPoint, AnnotationToolState } from '$lib/types/annotations.js';
	import { createAnnotation } from '$lib/types/annotations.js';
	import { getTimeline, getCommands, getPlayback } from '$lib/state/context.js';
	import { AddAnnotationCommand } from '$lib/commands/annotation-commands.js';
	import {
		drawAnnotation,
		drawAnnotations,
		hitTestAnnotations,
		simplifyStroke,
		toNormalised,
	} from '$lib/utils/annotation-render.js';
	import { generateId } from '$lib/utils/id.js';

	interface Props {
		/** Shared with AnnotationPanel; `tool: null` makes this layer inert. */
		tools: AnnotationToolState;
		/** Fires with a newly drawn annotation, or one tapped with a tool armed. */
		onselect?: (id: string | null) => void;
	}

	let { tools, onselect }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();

	let canvas: HTMLCanvasElement;
	let dpr = 1;
	/** The stroke under the pointer. Committed as a command only on release. */
	let draft = $state<Annotation | null>(null);
	/** Fixed corner for the two-point tools. */
	let anchor: AnnotationPoint | null = null;

	/** Minimum travel before a pen stroke records another point, normalised. */
	const POINT_SPACING = 0.002;

	/** A drag shorter than this is a tap, not a stroke. */
	const TAP_SLOP = 0.005;

	onMount(() => {
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		return () => observer.disconnect();
	});

	// Both the playhead moving and the annotation list changing alter what
	// should be on screen; the draft covers the in-progress stroke.
	$effect(() => {
		void playback.currentTime;
		void timeline.annotations;
		void draft;
		redraw();
	});

	function resize(): void {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		dpr = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(rect.width * dpr));
		canvas.height = Math.max(1, Math.round(rect.height * dpr));
		redraw();
	}

	function redraw(): void {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Draw in CSS pixels so stroke widths scale with the frame, not the
		// display density — the export does the same at its own resolution.
		const width = canvas.width / dpr;
		const height = canvas.height / dpr;
		ctx.save();
		ctx.scale(dpr, dpr);
		drawAnnotations(ctx, timeline.annotations, playback.currentTime, width, height);
		if (draft) drawAnnotation(ctx, draft, width, height);
		ctx.restore();
	}

	function pointAt(event: PointerEvent): AnnotationPoint {
		const rect = canvas.getBoundingClientRect();
		return toNormalised(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!tools.tool) return;
		event.preventDefault();
		canvas.setPointerCapture(event.pointerId);

		const point = pointAt(event);
		anchor = point;
		draft = createAnnotation({
			id: generateId(),
			type: tools.tool,
			points: [point],
			color: tools.color,
			strokeWidth: tools.strokeWidth,
			startTime: playback.currentTime,
			endTime: playback.currentTime + tools.duration,
		});
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!draft || !anchor) return;
		const point = pointAt(event);

		if (draft.type === 'pen' || draft.type === 'highlighter') {
			const last = draft.points[draft.points.length - 1];
			// pointermove fires per frame; without a spacing floor a slow drag
			// records hundreds of coincident points.
			if (Math.hypot(point.x - last.x, point.y - last.y) < POINT_SPACING) return;
			draft = { ...draft, points: [...draft.points, point] };
		} else {
			draft = { ...draft, points: [anchor, point] };
		}
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!draft) return;
		canvas.releasePointerCapture(event.pointerId);

		const finished = draft;
		draft = null;
		anchor = null;

		if (isTap(finished)) {
			// A tap on existing ink selects it. Without this the only way to
			// reach an annotation would be the panel list, and every stray
			// click with a tool armed would leave a dot behind.
			const rect = canvas.getBoundingClientRect();
			const hit = hitTestAnnotations(
				timeline.annotations,
				finished.points[0],
				rect.width,
				rect.height
			);
			if (hit) {
				onselect?.(hit.id);
				return;
			}
			// A two-point tool has no shape to draw from a single point.
			if (finished.type !== 'pen' && finished.type !== 'highlighter') return;
		}

		commit(finished);
	}

	function handlePointerCancel(): void {
		draft = null;
		anchor = null;
	}

	function isTap(annotation: Annotation): boolean {
		if (annotation.points.length > 2) return false;
		const first = annotation.points[0];
		const last = annotation.points[annotation.points.length - 1];
		return Math.hypot(last.x - first.x, last.y - first.y) < TAP_SLOP;
	}

	function commit(annotation: Annotation): void {
		const freehand = annotation.type === 'pen' || annotation.type === 'highlighter';
		const finished = freehand
			? { ...annotation, points: simplifyStroke(annotation.points) }
			: annotation;
		commands.execute(new AddAnnotationCommand(timeline, finished));
		onselect?.(finished.id);
	}
</script>

<svelte:window onresize={resize} />

<canvas
	bind:this={canvas}
	class="annotation-layer"
	class:armed={tools.tool !== null}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
></canvas>

<style>
	.annotation-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* Inert unless a tool is armed, so it never swallows clicks meant for
		   the preview underneath. */
		pointer-events: none;
		z-index: 15;
	}

	.annotation-layer.armed {
		pointer-events: auto;
		cursor: crosshair;
		/* Stops the webview treating a drag as a pan and cancelling the stroke. */
		touch-action: none;
	}
</style>
