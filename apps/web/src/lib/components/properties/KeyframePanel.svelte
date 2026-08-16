<script lang="ts">
	import type { Clip } from '$lib/types/index.js';
	import type { AnimatableProperty, AnimatablePropertyDef, EasingType } from '$lib/types/keyframes.js';
	import { ANIMATABLE_PROPERTY_LIST, AUDIO_PROPERTIES, EASING_LABELS } from '$lib/types/keyframes.js';
	import { evaluateProperty, trackFor, keyframeAt, sortKeyframes } from '$lib/utils/keyframes.js';
	import { getTimeline, getCommands, getPlayback } from '$lib/state/context.js';
	import {
		SetKeyframeCommand,
		RemoveKeyframeCommand,
		UpdateKeyframeCommand,
		ClearPropertyKeyframesCommand,
		ClearAllKeyframesCommand,
	} from '$lib/commands/keyframe-commands.js';
	import { formatDuration } from '$lib/utils/time.js';

	interface Props {
		clip: Clip;
	}

	let { clip }: Props = $props();

	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();

	let expanded = $state(false);

	/** Playhead position relative to the clip — the space keyframes live in. */
	let timeInClip = $derived(
		Math.max(0, Math.min(clip.duration, playback.currentTime - clip.timelineStart))
	);

	/** Only offer volume on something that actually carries audio. */
	let properties = $derived(
		ANIMATABLE_PROPERTY_LIST.filter((def) => {
			const audioOnly = AUDIO_PROPERTIES.includes(def.id);
			const hasAudio = clip.type === 'video' || clip.type === 'audio';
			const visual = clip.type !== 'audio';
			return audioOnly ? hasAudio : visual;
		})
	);

	let animatedCount = $derived((clip.keyframes ?? []).filter((t) => t.keyframes.length > 0).length);

	function keyframesFor(property: AnimatableProperty) {
		return sortKeyframes(trackFor(clip.keyframes, property)?.keyframes ?? []);
	}

	function isAnimated(property: AnimatableProperty): boolean {
		return keyframesFor(property).length > 0;
	}

	/** The keyframe sitting under the playhead, if any. */
	function keyframeHere(property: AnimatableProperty) {
		return keyframeAt(keyframesFor(property), timeInClip);
	}

	function currentValue(property: AnimatableProperty): number {
		return evaluateProperty(clip.keyframes, property, timeInClip);
	}

	/** Diamond button: add a keyframe here, or remove the one already here. */
	function toggleKeyframe(def: AnimatablePropertyDef) {
		const existing = keyframeHere(def.id);
		if (existing) {
			commands.execute(new RemoveKeyframeCommand(timeline, clip.id, def.id, existing.id));
		} else {
			commands.execute(
				new SetKeyframeCommand(timeline, clip.id, def.id, timeInClip, currentValue(def.id))
			);
		}
	}

	/**
	 * Dragging a slider writes a keyframe at the playhead once the property is
	 * animated, and otherwise sets a single one — which is how an animation
	 * usually starts.
	 */
	function handleValueChange(def: AnimatablePropertyDef, value: number) {
		commands.execute(new SetKeyframeCommand(timeline, clip.id, def.id, timeInClip, value));
	}

	function handleEasingChange(property: AnimatableProperty, keyframeId: string, easing: EasingType) {
		commands.execute(new UpdateKeyframeCommand(timeline, clip.id, property, keyframeId, { easing }));
	}

	function handleRemove(property: AnimatableProperty, keyframeId: string) {
		commands.execute(new RemoveKeyframeCommand(timeline, clip.id, property, keyframeId));
	}

	function handleClearProperty(property: AnimatableProperty) {
		commands.execute(new ClearPropertyKeyframesCommand(timeline, clip.id, property));
	}

	function handleClearAll() {
		commands.execute(new ClearAllKeyframesCommand(timeline, clip.id));
	}

	function seekTo(time: number) {
		playback.seek(clip.timelineStart + time);
	}

	/** Position along the mini timeline, as a percentage. */
	function offsetOf(time: number): number {
		return clip.duration > 0 ? Math.min(100, (time / clip.duration) * 100) : 0;
	}
</script>

<div class="keyframes">
	<button class="section-head" onclick={() => (expanded = !expanded)}>
		<span class="chevron" class:open={expanded}>▸</span>
		<h4>Animation</h4>
		{#if animatedCount > 0}
			<span class="badge">{animatedCount}</span>
		{/if}
	</button>

	{#if expanded}
		<p class="hint">
			Move the playhead, then press ◆ to set a keyframe at {formatDuration(timeInClip)}.
		</p>

		{#each properties as def (def.id)}
			{@const animated = isAnimated(def.id)}
			{@const here = keyframeHere(def.id)}
			{@const value = currentValue(def.id)}
			<div class="property" class:animated>
				<div class="property-head">
					<button
						class="diamond"
						class:on={animated}
						class:here={!!here}
						title={here ? 'Remove keyframe here' : 'Add keyframe here'}
						onclick={() => toggleKeyframe(def)}
						aria-label={here ? `Remove ${def.label} keyframe` : `Add ${def.label} keyframe`}
					>◆</button>
					<span class="property-label">{def.label}</span>
					<span class="property-value">{value.toFixed(def.step < 1 ? 1 : 0)}{def.unit}</span>
					{#if animated}
						<button class="clear" title="Clear this animation" onclick={() => handleClearProperty(def.id)}>×</button>
					{/if}
				</div>

				<input
					class="slider"
					type="range"
					min={def.min}
					max={def.max}
					step={def.step}
					value={value}
					oninput={(e) => handleValueChange(def, Number(e.currentTarget.value))}
					aria-label={def.label}
				/>

				{#if animated}
					{@const frames = keyframesFor(def.id)}
					<!-- Miniature track: each diamond is one keyframe in clip time. -->
					<div class="track">
						<div class="track-line"></div>
						{#each frames as frame (frame.id)}
							<button
								class="marker"
								style="left: {offsetOf(frame.time)}%"
								title="{formatDuration(frame.time)} · {frame.value.toFixed(0)}{def.unit}"
								onclick={() => seekTo(frame.time)}
								aria-label="Jump to keyframe at {formatDuration(frame.time)}"
							>◆</button>
						{/each}
						<div class="playhead" style="left: {offsetOf(timeInClip)}%"></div>
					</div>

					<div class="frame-list">
						{#each frames as frame (frame.id)}
							<div class="frame-row">
								<button class="frame-time" onclick={() => seekTo(frame.time)}>
									{formatDuration(frame.time)}
								</button>
								<span class="frame-value">{frame.value.toFixed(0)}{def.unit}</span>
								<select
									class="easing"
									value={frame.easing}
									onchange={(e) => handleEasingChange(def.id, frame.id, e.currentTarget.value as EasingType)}
									aria-label="Easing"
								>
									{#each Object.entries(EASING_LABELS) as [key, label]}
										<option value={key}>{label}</option>
									{/each}
								</select>
								<button class="frame-remove" onclick={() => handleRemove(def.id, frame.id)} aria-label="Remove keyframe">×</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}

		{#if animatedCount > 0}
			<button class="clear-all" onclick={handleClearAll}>Clear all animation</button>
		{/if}
	{/if}
</div>

<style>
	.keyframes {
		padding: 8px 0;
	}

	.section-head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		background: none;
		border: none;
		padding: 4px 0;
		cursor: pointer;
		color: var(--text-primary);
	}

	.section-head h4 {
		font-size: 12px;
		font-weight: 600;
		margin: 0;
	}

	.chevron {
		font-size: 10px;
		transition: transform 0.15s ease;
		color: var(--text-tertiary);
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.badge {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 8px;
		background: rgba(255, 51, 51, 0.15);
		color: #ff5555;
	}

	.hint {
		font-size: 11px;
		color: var(--text-tertiary);
		margin: 4px 0 10px;
		line-height: 1.4;
	}

	.property {
		padding: 6px 0;
		border-top: 1px solid var(--border-primary);
	}

	.property-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.diamond {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 11px;
		line-height: 1;
		padding: 2px;
		color: var(--text-tertiary);
		transition: color 0.15s ease, transform 0.1s ease;
	}

	.diamond:hover {
		transform: scale(1.25);
	}

	.diamond.on {
		color: #ff5555;
	}

	/* Filled ring marks the playhead sitting exactly on a keyframe. */
	.diamond.here {
		color: #fff;
		text-shadow: 0 0 6px #ff3333;
	}

	.property-label {
		font-size: 11px;
		color: var(--text-secondary);
		flex: 1;
	}

	.property-value {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}

	.clear,
	.frame-remove {
		background: none;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 0 2px;
	}

	.clear:hover,
	.frame-remove:hover {
		color: #ff5555;
	}

	.slider {
		width: 100%;
		margin: 4px 0 2px;
		accent-color: #ff3333;
	}

	.track {
		position: relative;
		height: 16px;
		margin: 2px 0 4px;
	}

	.track-line {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--border-primary);
		border-radius: 1px;
	}

	.marker {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		background: none;
		border: none;
		color: #ff5555;
		font-size: 10px;
		cursor: pointer;
		padding: 2px;
	}

	.marker:hover {
		color: #fff;
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(255, 255, 255, 0.55);
		pointer-events: none;
	}

	.frame-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.frame-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.frame-time {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		padding: 0;
		min-width: 44px;
		text-align: left;
	}

	.frame-time:hover {
		color: var(--text-primary);
	}

	.frame-value {
		font-size: 10px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		min-width: 40px;
	}

	.easing {
		flex: 1;
		font-size: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		padding: 1px 4px;
	}

	.clear-all {
		width: 100%;
		margin-top: 8px;
		padding: 5px;
		font-size: 11px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border-primary);
		border-radius: 5px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.clear-all:hover {
		background: rgba(255, 68, 68, 0.12);
		color: #ff5555;
	}
</style>
