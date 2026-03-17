<script lang="ts">
	import { getUI, getTimeline, getSelection, getPlayback, getCommands } from '$lib/state/context.js';
	import { SplitClipCommand, RemoveClipCommand, PasteClipsCommand, DuplicateClipsCommand, RemoveGapsCommand } from '$lib/commands/clip-commands.js';
	import { AddTrackCommand } from '$lib/commands/track-commands.js';
	import { GroupClipsCommand, UngroupClipsCommand } from '$lib/commands/group-commands.js';
	import Button from '../shared/Button.svelte';
	import Icon from '../shared/Icon.svelte';

	const ui = getUI();
	const timeline = getTimeline();
	const selection = getSelection();
	const playback = getPlayback();
	const commands = getCommands();

	function handleSplit() {
		for (const clipId of selection.selectedClipIds) {
			const clip = timeline.getClipById(clipId);
			if (!clip) continue;
			if (playback.currentTime > clip.timelineStart && playback.currentTime < clip.timelineStart + clip.duration) {
				commands.execute(new SplitClipCommand(timeline, clipId, playback.currentTime));
			}
		}
	}

	function handleDelete() {
		// Collect all clip IDs to delete, including grouped clips
		const toDelete = new Set<string>();
		for (const clipId of selection.selectedClipIds) {
			toDelete.add(clipId);
			const clip = timeline.getClipById(clipId);
			if (clip?.groupId) {
				const groupClips = timeline.getGroupClips(clip.groupId);
				for (const gc of groupClips) {
					toDelete.add(gc.id);
				}
			}
		}
		for (const clipId of toDelete) {
			commands.execute(new RemoveClipCommand(timeline, clipId));
		}
		selection.deselectAll();
	}

	function handleAddVideoTrack() {
		commands.execute(new AddTrackCommand(timeline, 'video'));
	}

	function handleAddAudioTrack() {
		commands.execute(new AddTrackCommand(timeline, 'audio'));
	}

	function toggleSnap() {
		ui.snapEnabled = !ui.snapEnabled;
	}

	function handleGroup() {
		if (selection.selectedClipIds.size < 2) return;
		commands.execute(new GroupClipsCommand(timeline, selection.selectedClipIds));
	}

	function handleUngroup() {
		for (const clipId of selection.selectedClipIds) {
			const clip = timeline.getClipById(clipId);
			if (clip?.groupId) {
				commands.execute(new UngroupClipsCommand(timeline, clip.groupId));
				break;
			}
		}
	}

	function handleRemoveSilences() {
		ui.showSilenceRemoval = true;
	}

	function handleRemoveGaps() {
		commands.execute(new RemoveGapsCommand(timeline));
	}

	let canRemoveSilences = $derived(() => {
		for (const clipId of selection.selectedClipIds) {
			const clip = timeline.getClipById(clipId);
			if (clip && (clip.type === 'video' || clip.type === 'audio')) return true;
		}
		return false;
	});

	function handleCopy() {
		const clips = Array.from(selection.selectedClipIds)
			.map((id) => timeline.getClipById(id))
			.filter((c): c is NonNullable<typeof c> => c != null);
		if (clips.length > 0) {
			selection.copySelectedClips(clips);
		}
	}

	function handlePaste() {
		if (!selection.hasClipboard) return;
		const cmd = new PasteClipsCommand(timeline, selection.clipboardClips, playback.currentTime);
		commands.execute(cmd);
		selection.deselectAll();
		for (const id of cmd.getPastedIds()) {
			selection.selectClip(id, true);
		}
	}

	function handleDuplicate() {
		const ids = Array.from(selection.selectedClipIds);
		if (ids.length === 0) return;
		const cmd = new DuplicateClipsCommand(timeline, ids);
		commands.execute(cmd);
		selection.deselectAll();
		for (const id of cmd.getDuplicatedIds()) {
			selection.selectClip(id, true);
		}
	}

	let hasClipsSelected = $derived(selection.selectedClipIds.size > 0);
	let canGroup = $derived(selection.selectedClipIds.size >= 2);
	let canUngroup = $derived(() => {
		for (const clipId of selection.selectedClipIds) {
			const clip = timeline.getClipById(clipId);
			if (clip?.groupId) return true;
		}
		return false;
	});
</script>

<div class="timeline-toolbar">
	<div class="toolbar-left">
		<Button variant="ghost" size="sm" active={ui.activeTool === 'select'} onclick={() => ui.activeTool = 'select'} title="Select (V)">
			<Icon name="cursor" size={14} />
		</Button>
		<Button variant="ghost" size="sm" active={ui.activeTool === 'razor'} onclick={() => ui.activeTool = 'razor'} title="Razor (C)">
			<Icon name="razor" size={14} />
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={handleSplit} disabled={!selection.hasSelection} title="Split at playhead (S)">
			<Icon name="split" size={14} />
		</Button>
		<Button variant="ghost" size="sm" onclick={handleDelete} disabled={!selection.hasSelection} title="Delete (Del)">
			<Icon name="delete" size={14} />
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={handleCopy} disabled={!hasClipsSelected} title="Copy (Ctrl+C)">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
			</svg>
		</Button>
		<Button variant="ghost" size="sm" onclick={handlePaste} disabled={!selection.hasClipboard} title="Paste (Ctrl+V)">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
			</svg>
		</Button>
		<Button variant="ghost" size="sm" onclick={handleDuplicate} disabled={!hasClipsSelected} title="Duplicate (Ctrl+D)">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="8" y="8" width="14" height="14" rx="2" ry="2"/><rect x="2" y="2" width="14" height="14" rx="2" ry="2"/>
			</svg>
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={handleRemoveSilences} disabled={!canRemoveSilences()} title="Remove Silences">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M2 12h4l3-9 4 18 3-9h4"/><line x1="18" y1="6" x2="22" y2="10"/><line x1="22" y1="6" x2="18" y2="10"/>
			</svg>
		</Button>
		<Button variant="ghost" size="sm" onclick={handleRemoveGaps} disabled={timeline.flatClips.length === 0} title="Remove all gaps (G)">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="8" width="6" height="8" rx="1"/><rect x="15" y="8" width="6" height="8" rx="1"/><path d="M9 12h6"/><path d="M12 9l3 3-3 3"/>
			</svg>
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={toggleSnap} active={ui.snapEnabled} title="Snap">
			<Icon name="snap" size={14} />
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={handleGroup} disabled={!canGroup} title="Group clips (Ctrl+G)">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/>
			</svg>
		</Button>
		<Button variant="ghost" size="sm" onclick={handleUngroup} disabled={!canUngroup()} title="Ungroup clips (Ctrl+Shift+G)">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/><line x1="7" y1="17" x2="17" y2="7"/>
			</svg>
		</Button>
	</div>

	<div class="toolbar-right">
		<Button variant="ghost" size="sm" onclick={handleAddVideoTrack} title="Add video track">
			+ V
		</Button>
		<Button variant="ghost" size="sm" onclick={handleAddAudioTrack} title="Add audio track">
			+ A
		</Button>
		<div class="sep"></div>
		<Button variant="ghost" size="sm" onclick={() => ui.zoomOut()} title="Zoom out (-)">
			<Icon name="zoom-out" size={14} />
		</Button>
		<span class="zoom-label">{Math.round(ui.timelineZoom)}%</span>
		<Button variant="ghost" size="sm" onclick={() => ui.zoomIn()} title="Zoom in (+)">
			<Icon name="zoom-in" size={14} />
		</Button>
	</div>
</div>

<style>
	.timeline-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-primary);
		height: 32px;
	}

	.toolbar-left, .toolbar-right {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.sep {
		width: 1px;
		height: 16px;
		background: var(--border-primary);
		margin: 0 4px;
	}

	.zoom-label {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		min-width: 35px;
		text-align: center;
	}
</style>
