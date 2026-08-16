<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		searchAudio,
		downloadTrack,
		formatLicence,
		remainingSearches,
		AUDIO_PRESETS,
		RATE_LIMIT_NOTE,
		type AudioTrack,
		type LicenceTier,
	} from '$lib/api/audio-library.js';
	import { getMediaLibrary, getTimeline, getCommands, getPlayback } from '$lib/state/context.js';
	import { AddClipCommand } from '$lib/commands/clip-commands.js';
	import { createClip } from '$lib/types/timeline.js';
	import { generateId } from '$lib/utils/id.js';
	import { formatDuration } from '$lib/utils/time.js';
	import type { AssetAttribution } from '$lib/types/media.js';

	const mediaLibrary = getMediaLibrary();
	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();

	let query = $state('');
	let tier = $state<LicenceTier>('cc0');
	let kind = $state<'all' | 'music' | 'sfx'>('all');
	let tracks = $state<AudioTrack[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let page = $state(1);
	let pageCount = $state(0);
	let addingId = $state<string | null>(null);
	let quota = $state<number | null>(null);

	let previewId = $state<string | null>(null);
	let previewAudio: HTMLAudioElement | null = null;

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | null = null;

	let presets = $derived(AUDIO_PRESETS.filter((p) => kind === 'all' || p.kind === kind));

	onDestroy(() => {
		clearTimeout(debounceTimer);
		controller?.abort();
		stopPreview();
	});

	async function run(nextPage = 1) {
		if (!query.trim()) {
			tracks = [];
			pageCount = 0;
			return;
		}

		// One in-flight search at a time; typing fast must not race.
		controller?.abort();
		controller = new AbortController();

		loading = true;
		error = null;

		try {
			const result = await searchAudio({
				query,
				tier,
				page: nextPage,
				signal: controller.signal,
			});
			tracks = result.tracks;
			page = result.page;
			pageCount = result.pageCount;
			quota = remainingSearches();
		} catch (err) {
			if ((err as Error).name === 'AbortError') return;
			error = (err as Error).message;
			tracks = [];
		} finally {
			loading = false;
		}
	}

	// Openverse allows 20 searches a minute, so this debounce is generous
	// on purpose — search-as-you-type would burn the daily quota in minutes.
	function handleInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => run(1), 500);
	}

	function applyPreset(preset: string) {
		query = preset;
		clearTimeout(debounceTimer);
		run(1);
	}

	function changeTier(next: LicenceTier) {
		tier = next;
		if (query.trim()) run(1);
	}

	function stopPreview() {
		previewAudio?.pause();
		previewAudio = null;
		previewId = null;
	}

	function togglePreview(track: AudioTrack) {
		if (previewId === track.id) {
			stopPreview();
			return;
		}
		stopPreview();
		previewAudio = new Audio(track.url);
		previewAudio.volume = 0.7;
		previewAudio.onended = () => stopPreview();
		previewAudio.onerror = () => {
			error = `Could not preview "${track.title}".`;
			stopPreview();
		};
		previewAudio.play().catch(() => stopPreview());
		previewId = track.id;
	}

	function attributionFor(track: AudioTrack): AssetAttribution {
		return {
			licence: track.licence,
			licenceLabel: formatLicence(track.licence, track.licenceVersion),
			licenceUrl: track.licenceUrl,
			creator: track.creator,
			creatorUrl: track.creatorUrl,
			sourceUrl: track.landingUrl,
			provider: track.provider,
			required: track.requiresAttribution,
			text: track.attribution,
		};
	}

	/** Downloads the track, adds it to the library, and drops it on an audio track. */
	async function addToTimeline(track: AudioTrack) {
		addingId = track.id;
		error = null;

		try {
			const file = await downloadTrack(track);
			const blobUrl = URL.createObjectURL(file);
			const assetId = generateId();

			// Trust the container over the search result: Openverse durations
			// are occasionally absent or stale.
			const duration = (await probeDuration(blobUrl)) || track.duration || 5;

			mediaLibrary.addAsset({
				id: assetId,
				name: file.name,
				file,
				blobUrl,
				type: 'audio',
				metadata: {
					duration,
					width: 0,
					height: 0,
					fps: 0,
					codec: '',
					audioCodec: track.filetype,
					bitrate: 0,
					fileSize: file.size,
					format: track.filetype,
				},
				thumbnails: [],
				waveform: null,
				addedAt: Date.now(),
				attribution: attributionFor(track),
			});

			let audioTrack = timeline.tracks.find((t) => t.type === 'audio');
			if (!audioTrack) audioTrack = timeline.addTrack('audio', 'Music');

			const clip = createClip({
				id: generateId(),
				name: track.title,
				type: 'audio',
				assetId,
				trackId: audioTrack.id,
				timelineStart: playback.currentTime,
				duration,
			});

			commands.execute(new AddClipCommand(timeline, audioTrack.id, clip));
		} catch (err) {
			error = (err as Error).message;
		} finally {
			addingId = null;
		}
	}

	function probeDuration(url: string): Promise<number> {
		return new Promise((resolve) => {
			const audio = new Audio();
			const done = (value: number) => resolve(Number.isFinite(value) ? value : 0);
			const timer = setTimeout(() => done(0), 5000);
			audio.onloadedmetadata = () => {
				clearTimeout(timer);
				done(audio.duration);
			};
			audio.onerror = () => {
				clearTimeout(timer);
				done(0);
			};
			audio.preload = 'metadata';
			audio.src = url;
		});
	}
</script>

<div class="audio-browser">
	<div class="search-row">
		<input
			class="search"
			type="search"
			placeholder="Search music and sound effects…"
			bind:value={query}
			oninput={handleInput}
		/>
	</div>

	<div class="filters">
		<div class="segmented" role="group" aria-label="Licence">
			<button class:on={tier === 'cc0'} onclick={() => changeTier('cc0')} title="Public domain — no credit needed">
				CC0 only
			</button>
			<button class:on={tier === 'attribution'} onclick={() => changeTier('attribution')} title="Adds CC BY — credit required">
				+ Credit OK
			</button>
		</div>
		<div class="segmented" role="group" aria-label="Kind">
			<button class:on={kind === 'all'} onclick={() => (kind = 'all')}>All</button>
			<button class:on={kind === 'music'} onclick={() => (kind = 'music')}>Music</button>
			<button class:on={kind === 'sfx'} onclick={() => (kind = 'sfx')}>SFX</button>
		</div>
	</div>

	<div class="presets">
		{#each presets as preset}
			<button class="chip" onclick={() => applyPreset(preset.query)}>{preset.label}</button>
		{/each}
	</div>

	{#if tier === 'cc0'}
		<p class="licence-note safe">Public domain only — usable anywhere, no credit required.</p>
	{:else}
		<p class="licence-note warn">
			Includes CC BY. Those tracks <strong>must be credited</strong> — the credit line is stored with the asset.
		</p>
	{/if}

	{#if error}
		<div class="error">{error}</div>
	{/if}

	{#if loading}
		<div class="status">Searching…</div>
	{:else if tracks.length === 0 && query.trim()}
		<div class="status">No results. Try a different word or the CC BY tier.</div>
	{:else if tracks.length === 0}
		<div class="status">Search, or pick a category above.</div>
	{/if}

	<div class="results">
		{#each tracks as track (track.id)}
			<div class="track">
				<button
					class="play"
					class:playing={previewId === track.id}
					onclick={() => togglePreview(track)}
					aria-label={previewId === track.id ? `Stop ${track.title}` : `Preview ${track.title}`}
				>{previewId === track.id ? '■' : '▶'}</button>

				<div class="meta">
					<div class="title" title={track.title}>{track.title}</div>
					<div class="sub">
						<span class="creator">{track.creator}</span>
						{#if track.duration > 0}
							<span class="dot">·</span><span>{formatDuration(track.duration)}</span>
						{/if}
						<span class="dot">·</span>
						<span class="badge" class:required={track.requiresAttribution}>
							{formatLicence(track.licence, track.licenceVersion)}
						</span>
					</div>
					{#if track.requiresAttribution}
						<div class="credit" title={track.attribution}>Credit required</div>
					{/if}
				</div>

				<button class="add" disabled={addingId === track.id} onclick={() => addToTimeline(track)}>
					{addingId === track.id ? '…' : '+'}
				</button>
			</div>
		{/each}
	</div>

	{#if pageCount > 1}
		<div class="pager">
			<button disabled={page <= 1 || loading} onclick={() => run(page - 1)}>Prev</button>
			<span>{page} / {pageCount}</span>
			<button disabled={page >= pageCount || loading} onclick={() => run(page + 1)}>Next</button>
		</div>
	{/if}

	<p class="quota">
		{#if quota !== null && quota < 40}
			<strong>{quota}</strong> searches left today · Openverse allows {RATE_LIMIT_NOTE}
		{:else}
			Audio from Openverse · {RATE_LIMIT_NOTE}
		{/if}
	</p>
</div>

<style>
	.audio-browser { padding: 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }

	.search {
		width: 100%; padding: 6px 8px; font-size: 12px;
		background: var(--bg-surface); border: 1px solid var(--border-primary);
		border-radius: 5px; color: var(--text-primary);
	}
	.search:focus { outline: none; border-color: rgba(255, 51, 51, 0.5); }

	.filters { display: flex; gap: 6px; }

	.segmented { display: flex; flex: 1; gap: 2px; }
	.segmented button {
		flex: 1; font-size: 10px; padding: 4px 2px; cursor: pointer;
		background: var(--bg-surface); color: var(--text-secondary);
		border: 1px solid var(--border-primary); border-radius: 4px;
		white-space: nowrap;
	}
	.segmented button.on {
		background: rgba(255, 51, 51, 0.15); color: #ff5555;
		border-color: rgba(255, 51, 51, 0.4);
	}

	.presets { display: flex; flex-wrap: wrap; gap: 4px; }
	.chip {
		font-size: 10px; padding: 3px 8px; cursor: pointer;
		background: rgba(255, 255, 255, 0.05); color: var(--text-secondary);
		border: 1px solid var(--border-primary); border-radius: 10px;
	}
	.chip:hover { background: rgba(255, 255, 255, 0.1); color: var(--text-primary); }

	.licence-note { font-size: 10px; line-height: 1.4; margin: 0; padding: 5px 7px; border-radius: 4px; }
	.licence-note.safe { color: #7fd18b; background: rgba(68, 255, 68, 0.07); }
	.licence-note.warn { color: #ffbf5f; background: rgba(255, 170, 0, 0.09); }
	.licence-note strong { font-weight: 600; }

	.error {
		font-size: 11px; color: #ff7777; background: rgba(255, 68, 68, 0.1);
		border: 1px solid rgba(255, 68, 68, 0.25); border-radius: 4px; padding: 6px 8px;
	}

	.status { font-size: 11px; color: var(--text-tertiary); padding: 12px 4px; text-align: center; }

	.results { display: flex; flex-direction: column; gap: 3px; }

	.track {
		display: flex; align-items: center; gap: 8px; padding: 6px;
		background: var(--bg-surface); border: 1px solid var(--border-primary); border-radius: 5px;
	}
	.track:hover { border-color: rgba(255, 255, 255, 0.18); }

	.play {
		flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		font-size: 9px; cursor: pointer;
		background: rgba(255, 255, 255, 0.08); color: var(--text-primary);
		border: 1px solid var(--border-primary);
	}
	.play.playing { background: rgba(255, 51, 51, 0.2); color: #ff5555; border-color: rgba(255, 51, 51, 0.45); }

	.meta { flex: 1; min-width: 0; }

	.title {
		font-size: 11px; color: var(--text-primary);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}

	.sub {
		display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
		font-size: 9px; color: var(--text-tertiary); margin-top: 2px;
	}
	.creator { max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.dot { opacity: 0.5; }

	.badge {
		padding: 0 4px; border-radius: 3px;
		background: rgba(68, 255, 68, 0.12); color: #7fd18b;
	}
	.badge.required { background: rgba(255, 170, 0, 0.14); color: #ffbf5f; }

	.credit { font-size: 9px; color: #ffbf5f; margin-top: 2px; }

	.add {
		flex-shrink: 0; width: 24px; height: 24px; border-radius: 4px;
		font-size: 14px; line-height: 1; cursor: pointer;
		background: rgba(255, 255, 255, 0.06); color: var(--text-secondary);
		border: 1px solid var(--border-primary);
	}
	.add:hover:not(:disabled) { background: rgba(255, 51, 51, 0.15); color: #ff5555; }
	.add:disabled { opacity: 0.5; cursor: default; }

	.pager {
		display: flex; align-items: center; justify-content: center; gap: 8px;
		font-size: 10px; color: var(--text-tertiary);
	}
	.pager button {
		font-size: 10px; padding: 3px 8px; cursor: pointer;
		background: var(--bg-surface); color: var(--text-secondary);
		border: 1px solid var(--border-primary); border-radius: 4px;
	}
	.pager button:disabled { opacity: 0.4; cursor: default; }

	.quota { font-size: 9px; color: var(--text-tertiary); text-align: center; margin: 2px 0 0; }
</style>
