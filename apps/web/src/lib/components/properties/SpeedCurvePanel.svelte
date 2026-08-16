<script lang="ts">
	import type { Clip, SpeedCurve, SpeedPoint } from '$lib/types/index.js';
	import { getTimeline, getCommands, getPlayback } from '$lib/state/context.js';
	import { SetSpeedCurveCommand } from '$lib/commands/keyframe-commands.js';
	import { averageSpeed } from '$lib/engine/ffmpeg-filters.js';
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

	let curve = $derived(clip.speedCurve);
	let enabled = $derived(!!curve?.enabled);
	let points = $derived([...(curve?.points ?? [])].sort((a, b) => a.time - b.time));
	let timeInClip = $derived(
		Math.max(0, Math.min(clip.duration, playback.currentTime - clip.timelineStart))
	);

	/** Output length after retiming, so the effect on the timeline is visible. */
	let resultDuration = $derived(
		enabled && points.length >= 2 ? clip.duration / averageSpeed(curve!) : clip.duration
	);

	const PRESETS: { label: string; build: () => SpeedPoint[] }[] = [
		{
			label: 'Ramp up',
			build: () => [
				{ id: generateId(), time: 0, speed: 1 },
				{ id: generateId(), time: clip.duration, speed: 3 },
			],
		},
		{
			label: 'Ramp down',
			build: () => [
				{ id: generateId(), time: 0, speed: 3 },
				{ id: generateId(), time: clip.duration, speed: 1 },
			],
		},
		{
			label: 'Slow middle',
			build: () => [
				{ id: generateId(), time: 0, speed: 2 },
				{ id: generateId(), time: clip.duration / 2, speed: 0.4 },
				{ id: generateId(), time: clip.duration, speed: 2 },
			],
		},
		{
			label: 'Jump cut',
			build: () => [
				{ id: generateId(), time: 0, speed: 1 },
				{ id: generateId(), time: clip.duration * 0.4, speed: 1 },
				{ id: generateId(), time: clip.duration * 0.45, speed: 6 },
				{ id: generateId(), time: clip.duration, speed: 1 },
			],
		},
	];

	function commit(next: SpeedCurve | null) {
		commands.execute(new SetSpeedCurveCommand(timeline, clip.id, next));
	}

	function handleEnable() {
		if (enabled) {
			commit(null);
			return;
		}
		commit({
			enabled: true,
			preservePitch: true,
			points: [
				{ id: generateId(), time: 0, speed: 1 },
				{ id: generateId(), time: clip.duration, speed: 2 },
			],
		});
	}

	function applyPreset(build: () => SpeedPoint[]) {
		commit({ enabled: true, preservePitch: curve?.preservePitch ?? true, points: build() });
	}

	function updatePoint(id: string, changes: Partial<SpeedPoint>) {
		if (!curve) return;
		commit({ ...curve, points: curve.points.map((p) => (p.id === id ? { ...p, ...changes } : p)) });
	}

	function addPointAtPlayhead() {
		if (!curve) return;
		// A new point should not change the curve's shape, so it takes the
		// speed the curve already has at that instant.
		const speed = speedAt(timeInClip);
		commit({
			...curve,
			points: [...curve.points, { id: generateId(), time: timeInClip, speed }],
		});
	}

	function removePoint(id: string) {
		if (!curve) return;
		const remaining = curve.points.filter((p) => p.id !== id);
		// Fewer than two points is not a curve; drop back to normal speed.
		commit(remaining.length >= 2 ? { ...curve, points: remaining } : null);
	}

	function speedAt(time: number): number {
		if (points.length === 0) return 1;
		if (time <= points[0].time) return points[0].speed;
		const last = points[points.length - 1];
		if (time >= last.time) return last.speed;
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			if (time >= a.time && time <= b.time) {
				const p = (time - a.time) / (b.time - a.time);
				return a.speed + (b.speed - a.speed) * p;
			}
		}
		return last.speed;
	}

	const MAX_SPEED = 8;

	/** Curve as an SVG polyline, speed plotted on a log scale so 0.5× and 2× sit
	 * the same distance either side of normal. */
	let polyline = $derived.by(() => {
		if (points.length < 2 || clip.duration <= 0) return '';
		return points
			.map((p) => {
				const x = (p.time / clip.duration) * 100;
				const ratio = Math.log(Math.min(Math.max(p.speed, 0.1), MAX_SPEED)) / Math.log(MAX_SPEED);
				const y = 100 - ((ratio + 1) / 2) * 100;
				return `${x.toFixed(2)},${Math.min(100, Math.max(0, y)).toFixed(2)}`;
			})
			.join(' ');
	});
</script>

<div class="speed">
	<button class="section-head" onclick={() => (expanded = !expanded)}>
		<span class="chevron" class:open={expanded}>▸</span>
		<h4>Speed Curve</h4>
		{#if enabled}
			<span class="badge">{points.length}</span>
		{/if}
	</button>

	{#if expanded}
		<p class="hint">Ramp the playback rate across the clip instead of setting one fixed speed.</p>

		<button class="enable" class:on={enabled} onclick={handleEnable}>
			{enabled ? 'Disable speed curve' : 'Enable speed curve'}
		</button>

		{#if enabled && points.length >= 2}
			<svg class="graph" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Speed curve">
				<line x1="0" y1="50" x2="100" y2="50" class="baseline" />
				<polyline points={polyline} class="curve" />
				<line
					x1={(timeInClip / clip.duration) * 100}
					y1="0"
					x2={(timeInClip / clip.duration) * 100}
					y2="100"
					class="playhead"
				/>
			</svg>
			<div class="readout">
				<span>{speedAt(timeInClip).toFixed(2)}× at playhead</span>
				<span>{formatDuration(clip.duration)} → {formatDuration(resultDuration)}</span>
			</div>

			<div class="presets">
				{#each PRESETS as preset}
					<button onclick={() => applyPreset(preset.build)}>{preset.label}</button>
				{/each}
			</div>

			<div class="points">
				{#each points as point (point.id)}
					<div class="point-row">
						<button class="point-time" onclick={() => playback.seek(clip.timelineStart + point.time)}>
							{formatDuration(point.time)}
						</button>
						<input
							class="point-speed"
							type="range"
							min="0.1"
							max={MAX_SPEED}
							step="0.1"
							value={point.speed}
							oninput={(e) => updatePoint(point.id, { speed: Number(e.currentTarget.value) })}
							aria-label="Speed at {formatDuration(point.time)}"
						/>
						<span class="point-value">{point.speed.toFixed(1)}×</span>
						<button class="point-remove" onclick={() => removePoint(point.id)} aria-label="Remove point">×</button>
					</div>
				{/each}
			</div>

			<button class="add" onclick={addPointAtPlayhead}>+ Add point at playhead</button>

			<p class="caveat">
				Video timing is exact. Audio is stretched by the average rate, so long ramps drift.
			</p>
		{/if}
	{/if}
</div>

<style>
	.speed { padding: 8px 0; }

	.section-head {
		display: flex; align-items: center; gap: 6px; width: 100%;
		background: none; border: none; padding: 4px 0; cursor: pointer; color: var(--text-primary);
	}
	.section-head h4 { font-size: 12px; font-weight: 600; margin: 0; }

	.chevron { font-size: 10px; color: var(--text-tertiary); transition: transform 0.15s ease; }
	.chevron.open { transform: rotate(90deg); }

	.badge {
		font-size: 10px; padding: 1px 6px; border-radius: 8px;
		background: rgba(255, 51, 51, 0.15); color: #ff5555;
	}

	.hint { font-size: 11px; color: var(--text-tertiary); margin: 4px 0 8px; line-height: 1.4; }

	.enable {
		width: 100%; padding: 5px; font-size: 11px; cursor: pointer;
		background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-primary);
		border-radius: 5px; color: var(--text-secondary);
	}
	.enable.on { background: rgba(255, 51, 51, 0.12); color: #ff5555; border-color: rgba(255, 51, 51, 0.35); }

	.graph {
		width: 100%; height: 64px; margin: 8px 0 2px;
		background: var(--bg-surface); border: 1px solid var(--border-primary); border-radius: 5px;
	}
	.baseline { stroke: rgba(255, 255, 255, 0.18); stroke-width: 0.5; stroke-dasharray: 2 2; vector-effect: non-scaling-stroke; }
	.curve { fill: none; stroke: #ff5555; stroke-width: 2; vector-effect: non-scaling-stroke; }
	.playhead { stroke: rgba(255, 255, 255, 0.5); stroke-width: 1; vector-effect: non-scaling-stroke; }

	.readout {
		display: flex; justify-content: space-between;
		font-size: 10px; color: var(--text-tertiary); font-variant-numeric: tabular-nums;
		margin-bottom: 6px;
	}

	.presets { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px; }
	.presets button {
		font-size: 10px; padding: 4px; cursor: pointer;
		background: var(--bg-surface); color: var(--text-secondary);
		border: 1px solid var(--border-primary); border-radius: 4px;
	}
	.presets button:hover { color: var(--text-primary); background: rgba(255, 255, 255, 0.08); }

	.points { display: flex; flex-direction: column; gap: 3px; }
	.point-row { display: flex; align-items: center; gap: 6px; }

	.point-time {
		background: none; border: none; color: var(--text-secondary);
		font-size: 10px; font-variant-numeric: tabular-nums; cursor: pointer;
		padding: 0; min-width: 42px; text-align: left;
	}
	.point-time:hover { color: var(--text-primary); }

	.point-speed { flex: 1; accent-color: #ff3333; }

	.point-value {
		font-size: 10px; color: var(--text-tertiary);
		font-variant-numeric: tabular-nums; min-width: 32px; text-align: right;
	}

	.point-remove {
		background: none; border: none; color: var(--text-tertiary);
		font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px;
	}
	.point-remove:hover { color: #ff5555; }

	.add {
		width: 100%; margin-top: 6px; padding: 5px; font-size: 11px; cursor: pointer;
		background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-primary);
		border-radius: 5px; color: var(--text-secondary);
	}
	.add:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-primary); }

	.caveat { font-size: 10px; color: var(--text-tertiary); margin: 8px 0 0; line-height: 1.4; }
</style>
