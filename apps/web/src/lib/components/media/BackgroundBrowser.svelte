<script lang="ts">
	import { getTimeline, getProject, getCommands } from '$lib/state/context.js';
	import { AddClipCommand } from '$lib/commands/clip-commands.js';
	import { AddTrackCommand } from '$lib/commands/track-commands.js';
	import { getMediaLibrary } from '$lib/state/context.js';
	import { generateId } from '$lib/utils/id.js';
	import { createClip } from '$lib/types/timeline.js';

	const timeline = getTimeline();
	const project = getProject();
	const commands = getCommands();
	const mediaLibrary = getMediaLibrary();

	const SOLID_COLORS = [
		{ name: 'Black', color: '#000000' },
		{ name: 'White', color: '#ffffff' },
		{ name: 'Red', color: '#ef4444' },
		{ name: 'Orange', color: '#f97316' },
		{ name: 'Yellow', color: '#eab308' },
		{ name: 'Green', color: '#22c55e' },
		{ name: 'Blue', color: '#3b82f6' },
		{ name: 'Purple', color: '#a855f7' },
		{ name: 'Pink', color: '#ec4899' },
		{ name: 'Teal', color: '#14b8a6' },
		{ name: 'Gray', color: '#6b7280' },
		{ name: 'Slate', color: '#334155' },
	];

	const GRADIENTS = [
		{ name: 'Sunset', gradient: 'linear-gradient(135deg, #f97316, #ec4899)' },
		{ name: 'Ocean', gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)' },
		{ name: 'Forest', gradient: 'linear-gradient(135deg, #22c55e, #14b8a6)' },
		{ name: 'Purple Haze', gradient: 'linear-gradient(135deg, #8b5cf6, #ec4899)' },
		{ name: 'Night Sky', gradient: 'linear-gradient(135deg, #1e1b4b, #312e81)' },
		{ name: 'Golden Hour', gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
		{ name: 'Ice', gradient: 'linear-gradient(135deg, #e0f2fe, #7dd3fc)' },
		{ name: 'Lava', gradient: 'linear-gradient(135deg, #dc2626, #f97316)' },
		{ name: 'Neon', gradient: 'linear-gradient(135deg, #a855f7, #06b6d4)' },
		{ name: 'Midnight', gradient: 'linear-gradient(135deg, #0f172a, #1e293b)' },
		{ name: 'Warm', gradient: 'linear-gradient(135deg, #fbbf24, #f97316, #ef4444)' },
		{ name: 'Cool', gradient: 'linear-gradient(135deg, #67e8f9, #818cf8, #c084fc)' },
	];

	let customColor = $state('#3b82f6');

	function createColorCanvas(fillStyle: string, isGradient = false): HTMLCanvasElement {
		const w = project.aspectRatio.width * 2;
		const h = project.aspectRatio.height * 2;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d')!;
		if (isGradient) {
			// Parse CSS gradient and draw
			const grad = ctx.createLinearGradient(0, 0, w, h);
			// Extract colors from gradient string
			const colorMatch = fillStyle.match(/#[0-9a-fA-F]{6}/g);
			if (colorMatch) {
				colorMatch.forEach((c, i) => {
					grad.addColorStop(i / Math.max(colorMatch.length - 1, 1), c);
				});
			}
			ctx.fillStyle = grad;
		} else {
			ctx.fillStyle = fillStyle;
		}
		ctx.fillRect(0, 0, w, h);
		return canvas;
	}

	async function addBackground(name: string, fillStyle: string, isGradient = false) {
		const canvas = createColorCanvas(fillStyle, isGradient);
		const blob = await new Promise<Blob>((resolve) => {
			canvas.toBlob((b) => resolve(b!), 'image/png');
		});
		const file = new File([blob], `${name.toLowerCase().replace(/\s+/g, '-')}-bg.png`, { type: 'image/png' });
		const blobUrl = URL.createObjectURL(blob);
		const asset = {
			id: generateId(),
			name: `${name} Background`,
			file,
			blobUrl,
			type: 'image' as const,
			metadata: {
				duration: 0,
				width: canvas.width,
				height: canvas.height,
				fps: 0,
				codec: 'png',
				audioCodec: '',
				bitrate: 0,
				fileSize: blob.size,
				format: 'png',
			},
			thumbnails: [blobUrl],
			waveform: null,
			addedAt: Date.now(),
		};
		mediaLibrary.addAsset(asset);

		// Add to timeline
		let track = timeline.tracks.find((t) => t.type === 'video');
		if (!track) {
			track = timeline.addTrack('video');
		}
		const clip = createClip({
			id: generateId(),
			name: `${name} BG`,
			type: 'image',
			assetId: asset.id,
			trackId: track.id,
			timelineStart: timeline.totalDuration,
			duration: 5,
		});
		track.clips.push(clip);
		timeline.tracks = [...timeline.tracks];
	}
</script>

<div class="bg-browser">
	<h5>Solid Colors</h5>
	<div class="color-grid">
		{#each SOLID_COLORS as item}
			<button
				class="color-swatch"
				style="background: {item.color};"
				title={item.name}
				onclick={() => addBackground(item.name, item.color)}
			></button>
		{/each}
		<div class="custom-color">
			<input type="color" bind:value={customColor} class="color-picker" />
			<button class="add-custom" onclick={() => addBackground('Custom', customColor)}>+</button>
		</div>
	</div>

	<h5>Gradients</h5>
	<div class="gradient-grid">
		{#each GRADIENTS as item}
			<button
				class="gradient-swatch"
				style="background: {item.gradient};"
				title={item.name}
				onclick={() => addBackground(item.name, item.gradient, true)}
			>
				<span class="gradient-label">{item.name}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.bg-browser {
		padding: 8px;
		overflow-y: auto;
	}

	h5 {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		margin: 0 0 8px;
	}

	.color-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 4px;
		margin-bottom: 16px;
	}

	.color-swatch {
		aspect-ratio: 1;
		border-radius: 4px;
		border: 2px solid transparent;
		cursor: pointer;
		transition: border-color 0.15s, transform 0.1s;
	}

	.color-swatch:hover {
		border-color: var(--accent);
		transform: scale(1.1);
	}

	.custom-color {
		display: flex;
		gap: 2px;
		grid-column: span 2;
	}

	.color-picker {
		width: 100%;
		height: 100%;
		min-height: 28px;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		padding: 0;
	}

	.add-custom {
		width: 28px;
		background: var(--bg-surface);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		color: var(--text-secondary);
		font-size: 16px;
		cursor: pointer;
	}

	.add-custom:hover {
		background: var(--bg-hover);
	}

	.gradient-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 6px;
		margin-bottom: 12px;
	}

	.gradient-swatch {
		height: 48px;
		border-radius: 6px;
		border: 2px solid transparent;
		cursor: pointer;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 4px;
		transition: border-color 0.15s, transform 0.1s;
	}

	.gradient-swatch:hover {
		border-color: var(--accent);
		transform: scale(1.02);
	}

	.gradient-label {
		font-size: 9px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
	}
</style>
