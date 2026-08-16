<script lang="ts">
	import type { Clip, MosaicRegion } from '$lib/types/index.js';
	import { getTimeline, getCommands, getPlayback } from '$lib/state/context.js';
	import { AddMosaicCommand, UpdateMosaicCommand, RemoveMosaicCommand } from '$lib/commands/keyframe-commands.js';
	import { generateId } from '$lib/utils/id.js';
	import { formatDuration } from '$lib/utils/time.js';

	interface Props {
		clip: Clip;
	}

	let { clip }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();

	let expanded = $state(false);
	let selectedId = $state<string | null>(null);

	let regions = $derived(clip.mosaics ?? []);
	let selected = $derived(regions.find((r) => r.id === selectedId) ?? null);
	let timeInClip = $derived(
		Math.max(0, Math.min(clip.duration, playback.currentTime - clip.timelineStart))
	);

	function handleAdd() {
		// A middle-of-frame default is easier to grab and drag than a corner.
		const region: MosaicRegion = {
			id: generateId(),
			x: 35,
			y: 35,
			width: 30,
			height: 30,
			mode: 'pixelate',
			strength: 50,
			startTime: null,
			endTime: null,
		};
		commands.execute(new AddMosaicCommand(timeline, clip.id, region));
		selectedId = region.id;
	}

	function update(id: string, changes: Partial<MosaicRegion>) {
		commands.execute(new UpdateMosaicCommand(timeline, clip.id, id, changes));
	}

	function handleRemove(id: string) {
		commands.execute(new RemoveMosaicCommand(timeline, clip.id, id));
		if (selectedId === id) selectedId = null;
	}

	/** Limits a region to the current playhead onward, or clears the limit. */
	function toggleTimeRange(region: MosaicRegion) {
		if (region.startTime !== null || region.endTime !== null) {
			update(region.id, { startTime: null, endTime: null });
		} else {
			update(region.id, {
				startTime: timeInClip,
				endTime: Math.min(clip.duration, timeInClip + 2),
			});
		}
	}
</script>

<div class="mosaic">
	<button class="section-head" onclick={() => (expanded = !expanded)}>
		<span class="chevron" class:open={expanded}>▸</span>
		<h4>Mosaic</h4>
		{#if regions.length > 0}
			<span class="badge">{regions.length}</span>
		{/if}
	</button>

	{#if expanded}
		<p class="hint">Blur or pixelate a region — for faces, names, or anything on screen you don’t want shared.</p>

		{#each regions as region (region.id)}
			<div class="region" class:selected={selectedId === region.id}>
				<div class="region-head">
					<button class="region-name" onclick={() => (selectedId = selectedId === region.id ? null : region.id)}>
						{region.mode === 'blur' ? 'Blur' : 'Pixelate'}
						· {region.width.toFixed(0)}×{region.height.toFixed(0)}%
					</button>
					<button class="remove" onclick={() => handleRemove(region.id)} aria-label="Remove region">×</button>
				</div>

				{#if selectedId === region.id}
					<div class="controls">
						<div class="modes">
							<button class:on={region.mode === 'pixelate'} onclick={() => update(region.id, { mode: 'pixelate' })}>Pixelate</button>
							<button class:on={region.mode === 'blur'} onclick={() => update(region.id, { mode: 'blur' })}>Blur</button>
						</div>

						<label class="field">
							<span>Strength <em>{region.strength.toFixed(0)}</em></span>
							<input type="range" min="1" max="100" step="1" value={region.strength}
								oninput={(e) => update(region.id, { strength: Number(e.currentTarget.value) })} />
						</label>

						<div class="grid">
							<label class="field">
								<span>X <em>{region.x.toFixed(0)}%</em></span>
								<input type="range" min="0" max="100" step="0.5" value={region.x}
									oninput={(e) => update(region.id, { x: Number(e.currentTarget.value) })} />
							</label>
							<label class="field">
								<span>Y <em>{region.y.toFixed(0)}%</em></span>
								<input type="range" min="0" max="100" step="0.5" value={region.y}
									oninput={(e) => update(region.id, { y: Number(e.currentTarget.value) })} />
							</label>
							<label class="field">
								<span>W <em>{region.width.toFixed(0)}%</em></span>
								<input type="range" min="1" max="100" step="0.5" value={region.width}
									oninput={(e) => update(region.id, { width: Number(e.currentTarget.value) })} />
							</label>
							<label class="field">
								<span>H <em>{region.height.toFixed(0)}%</em></span>
								<input type="range" min="1" max="100" step="0.5" value={region.height}
									oninput={(e) => update(region.id, { height: Number(e.currentTarget.value) })} />
							</label>
						</div>

						<button class="range-toggle" onclick={() => toggleTimeRange(region)}>
							{#if region.startTime !== null || region.endTime !== null}
								Active {formatDuration(region.startTime ?? 0)}–{formatDuration(region.endTime ?? clip.duration)} · make it whole clip
							{:else}
								Whole clip · limit to a time range
							{/if}
						</button>

						{#if region.startTime !== null || region.endTime !== null}
							<div class="grid">
								<label class="field">
									<span>Start <em>{formatDuration(region.startTime ?? 0)}</em></span>
									<input type="range" min="0" max={clip.duration} step="0.05" value={region.startTime ?? 0}
										oninput={(e) => update(region.id, { startTime: Number(e.currentTarget.value) })} />
								</label>
								<label class="field">
									<span>End <em>{formatDuration(region.endTime ?? clip.duration)}</em></span>
									<input type="range" min="0" max={clip.duration} step="0.05" value={region.endTime ?? clip.duration}
										oninput={(e) => update(region.id, { endTime: Number(e.currentTarget.value) })} />
								</label>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		<button class="add" onclick={handleAdd}>+ Add region</button>
	{/if}
</div>

<style>
	.mosaic { padding: 8px 0; }

	.section-head {
		display: flex; align-items: center; gap: 6px; width: 100%;
		background: none; border: none; padding: 4px 0; cursor: pointer;
		color: var(--text-primary);
	}
	.section-head h4 { font-size: 12px; font-weight: 600; margin: 0; }

	.chevron { font-size: 10px; color: var(--text-tertiary); transition: transform 0.15s ease; }
	.chevron.open { transform: rotate(90deg); }

	.badge {
		font-size: 10px; padding: 1px 6px; border-radius: 8px;
		background: rgba(255, 51, 51, 0.15); color: #ff5555;
	}

	.hint { font-size: 11px; color: var(--text-tertiary); margin: 4px 0 8px; line-height: 1.4; }

	.region { border-top: 1px solid var(--border-primary); padding: 5px 0; }
	.region-head { display: flex; align-items: center; gap: 6px; }

	.region-name {
		flex: 1; text-align: left; background: none; border: none;
		color: var(--text-secondary); font-size: 11px; cursor: pointer; padding: 2px 0;
	}
	.region.selected .region-name { color: var(--text-primary); }

	.remove {
		background: none; border: none; color: var(--text-tertiary);
		font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px;
	}
	.remove:hover { color: #ff5555; }

	.controls { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 2px; }

	.modes { display: flex; gap: 4px; }
	.modes button {
		flex: 1; font-size: 10px; padding: 4px; cursor: pointer;
		background: var(--bg-surface); color: var(--text-secondary);
		border: 1px solid var(--border-primary); border-radius: 4px;
	}
	.modes button.on { background: rgba(255, 51, 51, 0.15); color: #ff5555; border-color: rgba(255, 51, 51, 0.4); }

	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

	.field { display: flex; flex-direction: column; gap: 2px; }
	.field span { font-size: 10px; color: var(--text-tertiary); display: flex; justify-content: space-between; }
	.field em { font-style: normal; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
	.field input { width: 100%; accent-color: #ff3333; }

	.range-toggle {
		font-size: 10px; padding: 4px; cursor: pointer; text-align: left;
		background: none; border: 1px dashed var(--border-primary);
		border-radius: 4px; color: var(--text-tertiary);
	}
	.range-toggle:hover { color: var(--text-secondary); }

	.add {
		width: 100%; margin-top: 6px; padding: 5px; font-size: 11px; cursor: pointer;
		background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-primary);
		border-radius: 5px; color: var(--text-secondary);
	}
	.add:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-primary); }
</style>
