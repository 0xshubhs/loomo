<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getTimeline, getPlayback, getMediaLibrary, getUI, getSelection, getCommands, getCaptions } from '$lib/state/context.js';
	import { createFFmpegEngine } from '$lib/engine/ffmpeg-engine.js';
	import { importMediaFile } from '$lib/engine/media-import.js';
	import { exportTimeline } from '$lib/engine/export-pipeline.js';
	import { saveOutput } from '$lib/desktop/save.js';
	import { matchShortcut } from '$lib/utils/keyboard.js';
	import { SplitClipCommand, RemoveClipCommand, PasteClipsCommand, DuplicateClipsCommand, RemoveGapsCommand } from '$lib/commands/clip-commands.js';
	import { AddTextOverlayCommand } from '$lib/commands/text-commands.js';
	import { GroupClipsCommand, UngroupClipsCommand } from '$lib/commands/group-commands.js';
	import type { ExportConfig, ExportProgress } from '$lib/types/index.js';

	import EditorLayout from '$lib/components/layout/EditorLayout.svelte';
	import TopBar from '$lib/components/layout/TopBar.svelte';
	import StatusBar from '$lib/components/layout/StatusBar.svelte';
	import MediaBrowser from '$lib/components/media/MediaBrowser.svelte';
	import PreviewPanel from '$lib/components/preview/PreviewPanel.svelte';
	import TimelinePanel from '$lib/components/timeline/TimelinePanel.svelte';
	import PropertiesPanel from '$lib/components/properties/PropertiesPanel.svelte';
	import ExportDialog from '$lib/components/export/ExportDialog.svelte';
	import ShortcutsModal from '$lib/components/shared/ShortcutsModal.svelte';
	import CaptionDialog from '$lib/components/shared/CaptionDialog.svelte';
	import SilenceRemovalDialog from '$lib/components/shared/SilenceRemovalDialog.svelte';
	import VoiceoverDialog from '$lib/components/shared/VoiceoverDialog.svelte';

	const timeline = getTimeline();
	const playback = getPlayback();
	const mediaLibrary = getMediaLibrary();
	const ui = getUI();
	const selection = getSelection();
	const commands = getCommands();
	const captions = getCaptions();

	let ffmpeg = createFFmpegEngine();
	let exportProgress = $state<ExportProgress | null>(null);
	let appReady = $state(false);
	let ffmpegError = $state<string | null>(null);
	let importError = $state<string | null>(null);
	let importStatus = $state<string | null>(null);
	let showShortcuts = $state(false);

	onMount(async () => {
		appReady = true;
		try {
			await ffmpeg.initialize();
		} catch (err) {
			console.warn('FFmpeg initialization failed:', err);
			ffmpegError = `FFmpeg failed to load: ${err}. Video transcoding won't be available but native formats may still work.`;
		}
	});

	onDestroy(() => {
		ffmpeg.terminate();
		mediaLibrary.clear();
	});

	async function handleImport(files: File[]) {
		mediaLibrary.importing = true;
		importError = null;
		const errors: string[] = [];

		for (let i = 0; i < files.length; i++) {
			mediaLibrary.importProgress = (i + 0.5) / files.length;
			importStatus = `Importing ${files[i].name}... (${i + 1}/${files.length})`;

			try {
				const asset = await importMediaFile(files[i], ffmpeg);
				mediaLibrary.addAsset(asset);
				console.info(`[import] added "${asset.name}" — library now has ${mediaLibrary.assets.length}`);

				// Auto-create track if none exist
				if (timeline.tracks.length === 0) {
					const trackType = asset.type === 'audio' ? 'audio' : 'video';
					timeline.addTrack(trackType);
				}
			} catch (err) {
				console.error(`Failed to import ${files[i].name}:`, err);
				errors.push(`${files[i].name}: ${err}`);
			}
		}

		mediaLibrary.importing = false;
		mediaLibrary.importProgress = 0;
		importStatus = null;

		if (errors.length > 0) {
			importError = `Failed to import: ${errors.join(', ')}`;
			setTimeout(() => { importError = null; }, 8000);
		}
	}

	async function handleExport(config: ExportConfig) {
		try {
			const blob = await exportTimeline(
				ffmpeg,
				timeline.tracks,
				timeline.transitions,
				timeline.textOverlays,
				config,
				(progress) => { exportProgress = progress; },
				(assetId) => {
					const asset = mediaLibrary.getAssetById(assetId);
					if (!asset) return undefined;
					return { file: asset.file, name: asset.name };
				},
				timeline.shapeOverlays,
				captions.captionTrack,
				timeline.annotations
			);

			// Ask where to put it. On the desktop this is a real Save dialog and
			// the bytes are copied natively; on the web it falls back to a
			// browser download. Dropping the file into ~/Downloads unannounced
			// is not a reasonable end to a render that took minutes.
			const suggested = `loomo-export.${config.format}`;
			const saved = await saveOutput({ suggestedName: suggested, blob });

			ui.showExportDialog = false;
			exportProgress = null;
			if (saved.saved && saved.path) {
				importStatus = `Saved to ${saved.path}`;
				setTimeout(() => { importStatus = null; }, 8000);
			}
		} catch (err) {
			console.error('Export failed:', err);
			importError = `Export failed: ${err}`;
			setTimeout(() => { importError = null; }, 10000);
			exportProgress = {
				stage: 'error', progress: 0, currentFrame: 0,
				totalFrames: 0, elapsed: 0, eta: 0, outputSize: 0,
			};
		}
	}

	function handleNewProject() {
		timeline.clear();
		mediaLibrary.clear();
		selection.deselectAll();
		commands.clear();
		playback.goToStart();
		playback.pause();
		importError = null;
	}

	function openFileDialog() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'video/*,audio/*,image/*,.mkv,.avi,.mov,.flv,.wmv,.ts,.mts';
		input.multiple = true;
		input.onchange = () => {
			if (input.files) handleImport(Array.from(input.files));
		};
		input.click();
	}

	function handleKeydown(e: KeyboardEvent) {
		// Allow Escape through even in modals
		if (e.key === 'Escape' && showShortcuts) return;

		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
		if (showShortcuts) return;

		const shortcut = matchShortcut(e);
		if (!shortcut) return;

		e.preventDefault();

		switch (shortcut.action) {
			case 'playback.toggle': playback.toggle(); break;
			case 'playback.pause': playback.pause(); break;
			case 'playback.rewind': playback.seekRelative(-5); break;
			case 'playback.forward': playback.seekRelative(5); break;
			case 'playback.start': playback.goToStart(); break;
			case 'playback.end': playback.seek(timeline.totalDuration); break;
			case 'playback.framePrev': playback.seekRelative(-1 / 30); break;
			case 'playback.frameNext': playback.seekRelative(1 / 30); break;
			case 'playback.jumpPrev': playback.seekRelative(-5); break;
			case 'playback.jumpNext': playback.seekRelative(5); break;
			case 'timeline.split':
				for (const clipId of selection.selectedClipIds) {
					const clip = timeline.getClipById(clipId);
					if (clip && playback.currentTime > clip.timelineStart && playback.currentTime < clip.timelineStart + clip.duration) {
						commands.execute(new SplitClipCommand(timeline, clipId, playback.currentTime));
					}
				}
				break;
			case 'timeline.delete':
				for (const clipId of selection.selectedClipIds) {
					commands.execute(new RemoveClipCommand(timeline, clipId));
				}
				selection.deselectAll();
				break;
			case 'history.undo': commands.undo(); break;
			case 'history.redo': commands.redo(); break;
			case 'selection.clear': selection.deselectAll(); break;
			case 'selection.all':
				for (const clip of timeline.flatClips) selection.selectClip(clip.id, true);
				break;
			case 'clipboard.copy': {
				const clipsToCopy = Array.from(selection.selectedClipIds)
					.map((id) => timeline.getClipById(id))
					.filter((c): c is NonNullable<typeof c> => c != null);
				if (clipsToCopy.length > 0) {
					selection.copySelectedClips(clipsToCopy);
				}
				break;
			}
			case 'clipboard.paste': {
				if (selection.hasClipboard) {
					const cmd = new PasteClipsCommand(timeline, selection.clipboardClips, playback.currentTime);
					commands.execute(cmd);
					selection.deselectAll();
					for (const id of cmd.getPastedIds()) {
						selection.selectClip(id, true);
					}
				}
				break;
			}
			case 'clipboard.cut': {
				const clipsToCut = Array.from(selection.selectedClipIds)
					.map((id) => timeline.getClipById(id))
					.filter((c): c is NonNullable<typeof c> => c != null);
				if (clipsToCut.length > 0) {
					selection.copySelectedClips(clipsToCut);
					const idsToDelete = Array.from(selection.selectedClipIds);
					selection.deselectAll();
					for (const clipId of idsToDelete) {
						commands.execute(new RemoveClipCommand(timeline, clipId));
					}
				}
				break;
			}
			case 'editing.duplicate': {
				const idsToDuplicate = Array.from(selection.selectedClipIds);
				if (idsToDuplicate.length > 0) {
					const cmd = new DuplicateClipsCommand(timeline, idsToDuplicate);
					commands.execute(cmd);
					selection.deselectAll();
					for (const id of cmd.getDuplicatedIds()) {
						selection.selectClip(id, true);
					}
				}
				break;
			}
			case 'zoom.in': ui.zoomIn(); break;
			case 'zoom.out': ui.zoomOut(); break;
			case 'zoom.fit': ui.zoomToFit(timeline.totalDuration, window.innerWidth - ui.panelSizes.left - 120); break;
			case 'timeline.inPoint': break; // Future: set in point
			case 'timeline.outPoint': break; // Future: set out point
			case 'tool.select': ui.activeTool = 'select'; break;
			case 'tool.razor': ui.activeTool = 'razor'; break;
			case 'text.add': {
				const videoTrack = timeline.tracks.find(t => t.type === 'video');
				if (videoTrack) {
					const cmd = new AddTextOverlayCommand(timeline, videoTrack.id, playback.currentTime, 5);
					commands.execute(cmd);
					selection.selectText(cmd.getOverlayId());
					ui.activePanel = 'properties';
				}
				break;
			}
			case 'marker.add': break;
			case 'shortcuts.show': showShortcuts = true; break;
			case 'project.save': break;
			case 'export.open': ui.showExportDialog = true; break;
			case 'project.new': handleNewProject(); break;
			case 'preview.fullscreen':
				ui.previewFullscreen = !ui.previewFullscreen;
				break;
			case 'audio.toggleMute': break;
			case 'import.open': openFileDialog(); break;
			case 'timeline.group':
				if (selection.selectedClipIds.size >= 2) {
					commands.execute(new GroupClipsCommand(timeline, selection.selectedClipIds));
				}
				break;
			case 'timeline.ungroup':
				for (const clipId of selection.selectedClipIds) {
					const clip = timeline.getClipById(clipId);
					if (clip?.groupId) {
						commands.execute(new UngroupClipsCommand(timeline, clip.groupId));
						break;
					}
				}
				break;
			case 'timeline.removeGaps':
				commands.execute(new RemoveGapsCommand(timeline));
				break;
			case 'panels.toggleSidebar':
				ui.sidebarCollapsed = !ui.sidebarCollapsed;
				break;
			case 'panels.toggleTimeline':
				ui.timelineCollapsed = !ui.timelineCollapsed;
				break;
			case 'panels.toggleAll':
				ui.sidebarCollapsed = !ui.sidebarCollapsed;
				ui.timelineCollapsed = !ui.timelineCollapsed;
				break;
		}
	}

	function handleGlobalDrop(e: DragEvent) {
		e.preventDefault();
		if (!e.dataTransfer?.files.length) return;
		handleImport(Array.from(e.dataTransfer.files));
	}

	function handleGlobalDragOver(e: DragEvent) {
		e.preventDefault();
	}
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document ondrop={handleGlobalDrop} ondragover={handleGlobalDragOver} />

{#if !appReady}
	<div class="loading-screen">
		<div class="loading-content">
			<h1>MEOW</h1>
			<p>Loading editor...</p>
		</div>
	</div>
{:else}
	<!-- Status notifications -->
	{#if ffmpegError}
		<div class="notification warning">
			<span>{ffmpegError}</span>
			<button onclick={() => ffmpegError = null}>&times;</button>
		</div>
	{/if}

	{#if importError}
		<div class="notification error">
			<span>{importError}</span>
			<button onclick={() => importError = null}>&times;</button>
		</div>
	{/if}

	{#if importStatus}
		<div class="notification info">
			<span>{importStatus}</span>
		</div>
	{/if}

	{#if ffmpeg.busy}
		<div class="notification info">
			<span>{ffmpeg.currentOperation ?? 'Processing…'}</span>
		</div>
	{/if}

	<EditorLayout>
		{#snippet topbar()}
			<TopBar onimport={openFileDialog} onnewproject={handleNewProject} onshortcuts={() => showShortcuts = true} />
		{/snippet}

		{#snippet mediaBrowser()}
			<MediaBrowser onimport={handleImport} />
		{/snippet}

		{#snippet preview()}
			<PreviewPanel {ffmpeg} />
		{/snippet}

		{#snippet timeline()}
			<TimelinePanel />
		{/snippet}

		{#snippet properties()}
			<PropertiesPanel />
		{/snippet}

		{#snippet statusbar()}
			<StatusBar />
		{/snippet}

		{#snippet exportDialog()}
			<ExportDialog ffmpegReady={ffmpeg.ready} progress={exportProgress} onexport={handleExport} />
		{/snippet}
	</EditorLayout>

	<ShortcutsModal bind:open={showShortcuts} />
	<CaptionDialog />
	<SilenceRemovalDialog />
	<VoiceoverDialog />
{/if}

<style>
	.loading-screen {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
		z-index: 9999;
	}

	.loading-content {
		text-align: center;
	}

	.loading-content h1 {
		font-size: 32px;
		font-weight: 700;
		letter-spacing: 4px;
		margin-bottom: 12px;
	}

	.loading-content p {
		color: var(--text-muted);
		font-size: 13px;
	}

	.notification {
		position: fixed;
		top: 48px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 2000;
		padding: 8px 16px;
		border-radius: var(--radius-md);
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: 600px;
		animation: slideDown 0.2s ease;
	}

	.notification button {
		color: inherit;
		opacity: 0.6;
		font-size: 16px;
	}

	.notification.warning {
		background: #332b00;
		border: 1px solid #665500;
		color: #ffcc00;
	}

	.notification.error {
		background: #330000;
		border: 1px solid #660000;
		color: #ff4444;
	}

	.notification.info {
		background: #1a1a2a;
		border: 1px solid #333355;
		color: #8888ff;
	}

	@keyframes slideDown {
		from { transform: translateX(-50%) translateY(-10px); opacity: 0; }
		to { transform: translateX(-50%) translateY(0); opacity: 1; }
	}
</style>
