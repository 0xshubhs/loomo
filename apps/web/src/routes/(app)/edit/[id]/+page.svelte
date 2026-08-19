<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { getTimeline, getPlayback, getMediaLibrary, getUI, getSelection, getCommands, getCaptions, getProject } from '$lib/state/context.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { isDesktop } from '$lib/desktop/env.js';
	import { openProject, saveProject } from '$lib/project/store.js';
	import { createAutosave } from '$lib/project/autosave.js';
	import { ProjectFormatError } from '$lib/project/document.js';
	import { createFFmpegEngine } from '$lib/engine/ffmpeg-engine.js';
	import { importMediaFile, importMediaFromPath } from '$lib/engine/media-import.js';
	import { pickMediaFiles, type PickedFile } from '$lib/desktop/pick.js';
	import { exportTimeline } from '$lib/engine/export-pipeline.js';
	import { saveOutput } from '$lib/desktop/save.js';
	import { matchShortcut } from '$lib/utils/keyboard.js';
	import { addMarker, removeMarker, markerAt, nextMarker, previousMarker } from '$lib/timeline/markers.js';
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
	let showSavePrompt = $state(false);
	let saveError = $state<string | null>(null);
	/**
	 * Assets that opened without their media, or that a save could not copy.
	 *
	 * Kept as a dismissible banner rather than a toast: a clip with no bytes
	 * behind it is a problem the user has to act on, and a message that
	 * disappears after four seconds is a message they will meet again at
	 * export time instead.
	 */
	let missingMedia = $state<string[]>([]);

	const project = getProject();

	/** Roughly one write per half-minute of continuous editing. */
	const AUTOSAVE_DELAY_MS = 30_000;

	const autosave = createAutosave({
		delayMs: AUTOSAVE_DELAY_MS,
		save: () => saveCurrentProject({ quiet: true }),
		canSave: () =>
			isDesktop() &&
			project.dirty &&
			!project.saving &&
			// An untouched editor is not a project. Saving one would leave an
			// empty entry in the library every time someone opened the editor
			// and changed their mind.
			(mediaLibrary.assets.length > 0 || timeline.tracks.some((t) => t.clips.length > 0)) &&
			// Copying every clip into the project while ffmpeg is mid-render
			// would make an export that is already slow noticeably slower.
			!isExporting(),
	});

	/**
	 * How near the playhead has to be to count as "on" a marker.
	 *
	 * Measured in seconds but derived from the zoom, so removing a marker means
	 * the same thing on screen whether the timeline is showing ten seconds or
	 * ten minutes.
	 */
	function markerTolerance(): number {
		return 6 / Math.max(1, ui.pixelsPerSecond);
	}

	function isExporting(): boolean {
		return !!exportProgress && exportProgress.stage !== 'done' && exportProgress.stage !== 'error';
	}

	/**
	 * Every timeline edit makes the project dirty.
	 *
	 * Until this existed, `markDirty` was called only by the project-name field
	 * and the aspect-ratio picker — so trimming, splitting, deleting and
	 * dragging clips all left the project looking saved. The leave prompt never
	 * appeared for the case it was written for.
	 */
	$effect(() => {
		if (commands.revision > 0) untrack(() => project.markDirty());
	});

	// Arms the timer on the first unsaved change. The autosave itself decides
	// whether the write is worth doing.
	$effect(() => {
		if (project.dirty) autosave.noteChange();
	});

	onMount(async () => {
		appReady = true;
		project.id = page.params.id ?? null;

		try {
			await ffmpeg.initialize();
		} catch (err) {
			console.warn('FFmpeg initialization failed:', err);
			ffmpegError = `FFmpeg failed to load: ${err}. Video transcoding won't be available but native formats may still work.`;
		}

		await loadProject();
	});

	/**
	 * Restores a saved project, if there is one under this id.
	 *
	 * A brand new project has an id and nothing written under it, so "not
	 * found" is the ordinary case rather than an error.
	 */
	async function loadProject() {
		if (!project.id || !isDesktop()) return;

		try {
			const opened = await openProject(project.id);

			for (const asset of opened.assets) mediaLibrary.addAsset(asset);
			timeline.tracks = opened.document.tracks;
			timeline.transitions = opened.document.transitions;
			timeline.textOverlays = opened.document.textOverlays;
			timeline.shapeOverlays = opened.document.shapeOverlays;
			timeline.annotations = opened.document.annotations;
			timeline.markers = opened.document.markers;
			if (opened.document.captions) captions.captionTrack = opened.document.captions;

			missingMedia = opened.missing;
			project.name = opened.document.name;
			project.markSaved(opened.document.savedAt);
			commands.clear();
			importStatus = `Opened "${opened.document.name}"`;
			setTimeout(() => { importStatus = null; }, 4000);
		} catch (err) {
			// A project that has never been saved simply is not there.
			if (err instanceof ProjectFormatError) {
				saveError = err.message;
			} else {
				console.info('[project] nothing saved under this id yet:', err);
			}
		}
	}

	/**
	 * Writes the current state to disk, media and all.
	 *
	 * `quiet` is for autosave: it still reports failures, but says nothing on
	 * success, because a toast every half minute is noise.
	 */
	async function saveCurrentProject(options: { quiet?: boolean } = {}): Promise<boolean> {
		if (!isDesktop()) {
			if (!options.quiet) saveError = 'Projects are stored on disk and need the desktop app.';
			return false;
		}

		project.saving = true;
		saveError = null;
		try {
			const saved = await saveProject(
				{
					name: project.name,
					assets: mediaLibrary.assets,
					tracks: timeline.tracks,
					transitions: timeline.transitions,
					textOverlays: timeline.textOverlays,
					shapeOverlays: timeline.shapeOverlays,
					annotations: timeline.annotations,
					markers: timeline.markers,
					captions: captions.captionTrack ?? null,
					aspectRatio: project.aspectRatio.label,
				},
				{ id: project.id, now: Date.now() }
			);
			project.markSaved(Date.now());
			if (saved.skipped.length > 0) missingMedia = saved.skipped;
			if (!options.quiet) {
				importStatus = 'Project saved';
				setTimeout(() => { importStatus = null; }, 4000);
			}
			return true;
		} catch (err) {
			console.error('Save failed:', err);
			saveError = `Could not save the project: ${err}`;
			return false;
		} finally {
			project.saving = false;
		}
	}

	/** Leaving the editor: offer to save rather than dropping the work. */
	async function handleLeave() {
		if (project.dirty) {
			showSavePrompt = true;
			return;
		}
		await goto('/');
	}

	async function saveAndLeave() {
		showSavePrompt = false;
		if (await saveCurrentProject()) await goto('/');
	}

	async function discardAndLeave() {
		showSavePrompt = false;
		await goto('/');
	}

	onDestroy(() => {
		autosave.cancel();
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
				// Imported media belongs to the project even before it is
				// placed, so it has to be saved with it.
				project.markDirty();
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
			const result = await exportTimeline(
				ffmpeg,
				timeline.tracks,
				timeline.transitions,
				timeline.textOverlays,
				config,
				(progress) => { exportProgress = progress; },
				(assetId) => {
					const asset = mediaLibrary.getAssetById(assetId);
					if (!asset) return undefined;
					// scratchName lets the export reuse the copy import already
					// staged, instead of pushing the file through memory again.
					return {
						file: asset.file,
						name: asset.name,
						scratchName: asset.scratchName,
						// A reopened project's File is a placeholder; these are
						// the dimensions read at import.
						width: asset.metadata.width,
						height: asset.metadata.height,
					};
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
			try {
				const saved = await saveOutput({
					suggestedName: suggested,
					// On the desktop the render is already a file; only its name
					// travels, and the copy happens natively.
					scratchName: result.scratchName ?? undefined,
					blob: result.blob ?? undefined,
				});

				ui.showExportDialog = false;
				exportProgress = null;
				if (saved.saved && saved.path) {
					importStatus = `Saved to ${saved.path}`;
					setTimeout(() => { importStatus = null; }, 8000);
				} else if (!saved.saved) {
					importStatus = 'Export discarded — no location chosen';
					setTimeout(() => { importStatus = null; }, 6000);
				}
			} finally {
				// The render is left on disk until it has been saved, so it has
				// to be cleaned up here whether or not the user kept it.
				if (result.scratchName) {
					try { await ffmpeg.deleteFile(result.scratchName); } catch {}
				}
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

	/**
	 * Opens the file chooser.
	 *
	 * The desktop asks the OS and works from real paths. The webview's own
	 * `<input type="file">` percent-decodes filenames, so a name holding a
	 * literal `%20` resolved to nothing on disk and the page got a zero-byte
	 * `File` with no error — which surfaced minutes later as ffmpeg reporting
	 * "moov atom not found" on a source that was perfectly fine.
	 */
	async function openFileDialog() {
		if (isDesktop()) {
			try {
				const picked = await pickMediaFiles();
				if (picked.length > 0) await handleImportPaths(picked);
			} catch (err) {
				console.error('File picker failed:', err);
				importError = `Could not open the file picker: ${err}`;
				setTimeout(() => { importError = null; }, 8000);
			}
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'video/*,audio/*,image/*,.mkv,.avi,.mov,.flv,.wmv,.ts,.mts';
		input.multiple = true;
		input.onchange = () => {
			if (input.files) handleImport(Array.from(input.files));
		};
		input.click();
	}

	/** Imports files chosen by the native dialog, which hands back paths. */
	async function handleImportPaths(picked: PickedFile[]) {
		mediaLibrary.importing = true;
		importError = null;
		const errors: string[] = [];

		for (let i = 0; i < picked.length; i++) {
			mediaLibrary.importProgress = (i + 0.5) / picked.length;
			importStatus = `Importing ${picked[i].name}... (${i + 1}/${picked.length})`;

			try {
				const asset = await importMediaFromPath(picked[i], ffmpeg);
				mediaLibrary.addAsset(asset);
				project.markDirty();
				if (timeline.tracks.length === 0) {
					timeline.addTrack(asset.type === 'audio' ? 'audio' : 'video');
				}
			} catch (err) {
				console.error(`Failed to import ${picked[i].name}:`, err);
				errors.push(`${picked[i].name}: ${err}`);
			}
		}

		mediaLibrary.importing = false;
		mediaLibrary.importProgress = 0;
		importStatus = null;

		if (errors.length > 0) {
			importError = `Failed to import: ${errors.join(', ')}`;
			setTimeout(() => { importError = null; }, 12000);
		}
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
			case 'marker.add': {
				const next = addMarker(timeline.markers, playback.currentTime);
				// Unchanged means there was already one here — pressing M twice
				// on a frame is a slip, and marking the project dirty for it
				// would be a lie.
				if (next !== timeline.markers) {
					timeline.markers = next;
					project.markDirty();
				}
				break;
			}
			case 'marker.remove': {
				const existing = markerAt(timeline.markers, playback.currentTime, markerTolerance());
				if (existing) {
					timeline.markers = removeMarker(timeline.markers, existing.id);
					project.markDirty();
				}
				break;
			}
			case 'marker.next': {
				const target = nextMarker(timeline.markers, playback.currentTime);
				if (target) playback.seek(target.time);
				break;
			}
			case 'marker.prev': {
				const target = previousMarker(timeline.markers, playback.currentTime);
				if (target) playback.seek(target.time);
				break;
			}
			case 'shortcuts.show': showShortcuts = true; break;
			case 'project.save': void saveCurrentProject(); break;
			case 'export.open': ui.showExportDialog = true; break;
			case 'project.new': handleNewProject(); break;
			case 'preview.fullscreen':
				ui.previewFullscreen = !ui.previewFullscreen;
				break;
			case 'audio.toggleMute': playback.toggleMute(); break;
			case 'import.open': void openFileDialog(); break;
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
			<h1>Loomo</h1>
			<p>Loading editor…</p>
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

	{#if missingMedia.length > 0}
		<div class="notification warning">
			<span>
				Media is missing for {missingMedia.length === 1 ? '1 clip' : `${missingMedia.length} clips`}:
				{missingMedia.slice(0, 3).join(', ')}{missingMedia.length > 3 ? '…' : ''}.
				Those clips will be empty until the files are imported again.
			</span>
			<button onclick={() => missingMedia = []}>&times;</button>
		</div>
	{/if}

	{#if saveError}
		<div class="notification error">
			<span>{saveError}</span>
			<button onclick={() => saveError = null}>&times;</button>
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
			<TopBar
				onimport={() => void openFileDialog()}
				onnewproject={handleNewProject}
				onshortcuts={() => showShortcuts = true}
				onsave={() => void saveCurrentProject()}
				onleave={() => void handleLeave()}
			/>
		{/snippet}

		{#snippet mediaBrowser()}
			<MediaBrowser
				onimport={handleImport}
				onbrowse={isDesktop() ? () => void openFileDialog() : undefined}
			/>
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

	{#if showSavePrompt}
		<!-- Autosave runs every half minute, so at worst this covers the last
		     thirty seconds — but "Don't save" has to stay an explicit choice
		     rather than something the editor decides for the user. -->
		<div class="prompt-backdrop">
			<div class="prompt">
				<h3>Save this project?</h3>
				<p>You have changes that have not been saved yet.</p>
				<div class="prompt-actions">
					<button class="prompt-btn ghost" onclick={() => (showSavePrompt = false)}>Cancel</button>
					<button class="prompt-btn ghost" onclick={() => void discardAndLeave()}>Don't save</button>
					<button class="prompt-btn primary" onclick={() => void saveAndLeave()}>Save</button>
				</div>
			</div>
		</div>
	{/if}
	<CaptionDialog {ffmpeg} />
	<SilenceRemovalDialog {ffmpeg} />
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

	.prompt-backdrop {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.6);
		z-index: 10000;
	}

	.prompt {
		width: 340px;
		padding: 20px;
		border: 1px solid var(--border-primary);
		border-radius: 10px;
		background: var(--bg-secondary, #1a1a1a);
	}

	.prompt h3 {
		margin: 0 0 6px;
		font-size: 14px;
		color: var(--text-primary);
	}

	.prompt p {
		margin: 0 0 16px;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.prompt-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.prompt-btn {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--border-primary);
		background: transparent;
		color: var(--text-primary);
		font-size: 12px;
		cursor: pointer;
	}

	.prompt-btn.primary {
		border-color: transparent;
		background: var(--accent-primary, #ff5f45);
		color: #fff;
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
