<script lang="ts">
	import { getRecorder } from '$lib/state/context.js';
	import { onMount } from 'svelte';

	interface Props {
		stream: MediaStream | null;
	}

	let { stream }: Props = $props();

	const recorder = getRecorder();

	let videoEl: HTMLVideoElement | undefined = $state();
	let dragging = $state(false);
	let dragOffset = $state({ x: 0, y: 0 });

	const sizeMap = { sm: 80, md: 120, lg: 180 } as const;
	let bubbleSize = $derived(sizeMap[recorder.cameraBubbleSize]);

	let posX = $derived(recorder.cameraBubblePosition.x);
	let posY = $derived(recorder.cameraBubblePosition.y);

	$effect(() => {
		if (videoEl && stream) {
			videoEl.srcObject = stream;
		} else if (videoEl && !stream) {
			videoEl.srcObject = null;
		}
	});

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		dragOffset = {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		};
		el.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let newX = ((e.clientX - dragOffset.x + bubbleSize / 2) / vw) * 100;
		let newY = ((e.clientY - dragOffset.y + bubbleSize / 2) / vh) * 100;
		// Constrain to viewport
		const halfPctX = (bubbleSize / 2 / vw) * 100;
		const halfPctY = (bubbleSize / 2 / vh) * 100;
		newX = Math.max(halfPctX, Math.min(100 - halfPctX, newX));
		newY = Math.max(halfPctY, Math.min(100 - halfPctY, newY));
		recorder.cameraBubblePosition = { x: newX, y: newY };
	}

	function onPointerUp() {
		dragging = false;
	}
</script>

{#if recorder.showCamera && stream}
	<div
		class="camera-bubble"
		class:dragging
		style="
			width: {bubbleSize}px;
			height: {bubbleSize}px;
			left: calc({posX}% - {bubbleSize / 2}px);
			top: calc({posY}% - {bubbleSize / 2}px);
		"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		role="img"
		aria-label="Camera preview"
	>
		<video
			bind:this={videoEl}
			autoplay
			playsinline
			muted
			class="bubble-video"
		></video>
	</div>
{/if}

<style>
	.camera-bubble {
		position: fixed;
		z-index: 9998;
		border-radius: 50%;
		overflow: hidden;
		border: 3px solid white;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
		cursor: grab;
		touch-action: none;
		transition: box-shadow var(--transition-fast);
	}
	.camera-bubble:hover {
		box-shadow: 0 6px 32px rgba(0, 0, 0, 0.6);
	}
	.camera-bubble.dragging {
		cursor: grabbing;
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
	}
	.bubble-video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transform: scaleX(-1);
	}
</style>
