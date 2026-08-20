# What's left

State as of the last push. Written down so none of it has to be rediscovered.

---

## 1. Scope: editor only

The screen recorder was removed. It never worked reliably in the WebKitGTK
webview, and the last attempt — porting OBS's xdg-desktop-portal + PipeWire
sequence — was still unproven when the decision was made to drop it.

Everything for it is in git history if it is ever wanted back:

- `apps/desktop/src-tauri/src/capture.rs` — x11grab / avfoundation / gdigrab
- `apps/desktop/src-tauri/src/portal.rs` — the OBS portal sequence, in Rust
  (`CreateSession`, `SelectSources`, `Start`, `OpenPipeWireRemote` via ashpd),
  feeding GStreamer `pipewiresrc`. It compiled and the pipeline shape was
  verified to produce a playable MP4; the portal picker itself was never
  exercised in a real session.
- `apps/web/src/lib/recorder/`, `components/recorder/`, `state/recorder.svelte.ts`

Removing it also dropped the `gstreamer1.0-pipewire`, `-ugly`, `-tools` and
`xdg-desktop-portal` deb dependencies.

---

## 2. Projects — done, with edges

Saving copies each clip into the project folder and reopening stages it back,
both directions as a Rust file copy. The document format is versioned and
refuses anything written by a newer build.

Autosave runs every 30s of continuous editing — throttled from the first
unsaved change, not debounced, so it fires during the long session it exists
for. It skips an untouched editor so backing out of "New project" leaves
nothing behind, and stays quiet on success. Waveforms and markers persist.
Media that cannot be staged on open is named in a banner instead of a console
warning, and a save that could not copy a clip says so.

Remaining gaps:

- **Autosave writes the whole project**, media copies included. That is a
  Rust `fs::copy` per asset every half minute of editing — fine for a handful
  of clips, wasteful for fifty. It should skip assets whose copy is already
  there and unchanged.
- **A project cannot be duplicated or exported as a file.** There is no
  "save as", and no way to move a project between machines.

---

## 3. AI tools — infrastructure done, models not wired

`apps/web/src/lib/ai/` is complete and tested (199 tests): ONNX runtime
adapter, model registry, download cache with integrity checking, tensor
preprocessing, background removal, upscale, colorize. `AiToolsPanel.svelte`
exists and is **not mounted**.

Three things block inference:

1. `onnxruntime-web` is not installed. `bun add --cwd apps/web onnxruntime-web`,
   then `optimizeDeps.exclude` it in `vite.config.ts` and copy its wasm assets
   into `static/`.
2. Half the model URLs are dead — **verified, not guessed**:
   ```
   200  github.com/danielgatis/rembg/.../u2netp.onnx        cutout, works
   200  github.com/danielgatis/rembg/.../u2net.onnx         cutout, works
   200  huggingface.co/briaai/RMBG-1.4/.../model.onnx       cutout, works
   401  huggingface.co/Xenova/real-esrgan-x2plus/...        repo does not exist
   401  huggingface.co/Xenova/real-esrgan-x4plus/...        repo does not exist
   401  huggingface.co/Xenova/colorizer-siggraph17/...      repo does not exist
   ```
   Background removal can ship first. Candidates for the others, none
   inspected: `imgdesignart/realesrgan-x4-onnx`, `Meeperomi/RealESRGAN_x4-onnx`,
   `bukuroo/RealESRGAN-ONNX`, `Faridzar/manga-colorization-v2-onnx`.
3. Every `sha256` in the registry is `null`, so `ModelCache` reports
   `verified: false`. Download each once, hash it, pin the digest.

Tensor input/output names are guesses until a model actually loads.

---

## 4. Still missing from VN

- **Project templates** — VN ships ~150. Nothing exists.
- **BeatsClips** — auto-cut to music beats. Needs onset detection.
- **Masks** — shape/gradient masks per clip. Not started.

---

## 5. Known rough edges

- **Mosaic regions** are slider-driven; they should be draggable on the
  preview. The annotation layer proves that interaction works.
- **Pitch-preserving speed curves still drift.** `atempo` loses a fixed
  20–27ms per instance, so a curve with `preservePitch` set accumulates error
  the resampling path does not have. Correct sync needs a filter that
  time-stretches exactly, or a final length correction.
- **Preview audio window fetches are not cancelled.** Scrubbing quickly
  across a long clip queues extractions for windows the playhead has already
  left. They are cheap and the cache bounds memory, but the work is wasted.
- **Composited preview layers are decoded at 640px** and cached at 1/12s
  granularity, so an overlay is a fraction of a second stale while scrubbing
  fast. The base clip is not affected.
- **Bed audio is not drift-corrected.** The base clip resyncs when it drifts
  past 0.45s; bed players are started once and left to Web Audio's clock. On
  a long track they will separate.
- **Markers do not ripple.** Removing a gap or retiming a clip moves the
  footage out from under them.

---

### Fixed since the last pass

- **Speed-curve audio** followed the mean rate and drifted; it now follows the
  curve slice by slice, verified against real ffmpeg at 0.37ms out over six
  seconds (was 192ms on the pitch-preserving path).
- **Captions and bed audio** — windowed transcription, and the same drift
  correction the base clip gets.
- **Markers ripple** with gap closing and retiming, undoably.

- **Autosave recopied every asset, every time.** `projects_import_media` did
  an unconditional `fs::copy`, and autosave asks for every asset every thirty
  seconds — on a timeline holding two 900 MB sources that was 1.8 GB rewritten
  twice a minute. It now skips a destination that already holds a file of the
  same length, which is sufficient because the source is a scratch copy
  written once at import and never modified.
- **Silence detection now works on large files**, via ffmpeg's `silencedetect`
  rather than decoding the whole source in the page.

- **Clips had no bounds.** Dragging one left from the start ran its
  `timelineStart` negative and it kept going; the trim handles could seek
  before the beginning of the media, extend past its end, or reduce a clip to
  a negative length. None of it was clamped anywhere.

- **Preview audio decoded whole clips.** ~40 MB/minute, so a 50-minute source
  reached ~2.5 GB and the app was OOM-killed mid-import. It reads 30-second
  windows now, holding two.
- **Captions still read the whole file** into the page and refuse above
  400 MB. Silence detection was moved to ffmpeg; captions cannot be, because
  the Web Speech API needs the audio itself — it needs chunking into windows
  and transcribing each, which is not done.

- **Import by path, not through the webview.** WebKitGTK's file input
  percent-decodes the filename it reports; a file actually named
  `Members%20Only%20S2.mp4` resolved to nothing and the page received a
  zero-byte `File` with no error anywhere, surfacing minutes later as
  `moov atom not found`. The desktop now uses the OS dialog, Rust copies from
  the real path, and probing and thumbnails come from ffprobe and ffmpeg
  rather than a `<video>` element — the same reason the preview stopped using
  one. Extensions derived from user filenames are reduced to letters and
  digits before being concatenated into a path a process opens.
- **Audio and images were never staged.** Only video got a scratch copy, so
  a music bed had nothing for the preview mixer to play and an overlay image
  had nothing to decode. Every type is staged now.
- **`getExt('recording')` returned `'recording'`.** `split('.').pop()` on a
  name with no dot returns the whole name, so a file without an extension got
  a working file named after itself.

- **Markers.** `M` was in the keyboard map and wired to nothing for the whole
  life of the app. Now: add, remove, walk between, rename from the ruler,
  drawn as a flag plus a line down the tracks, snapped to when dragging
  clips, and saved with the project.
- **Master mute.** `Ctrl+Shift+M` was also wired to nothing, and
  `playback.volume` was state no code read. Both reach the preview now,
  including the audio bed.
- **Preview audio played one clip.** The export mixes every audio track, so a
  music bed was in the file and not in the editor. Each sounding audio-track
  clip now gets its own player, started and stopped against the playhead.
- **Nothing marked the project dirty on an edit.** The leave prompt and
  autosave both hang off `project.dirty`, and only the name field and the
  aspect-ratio picker ever set it. Every timeline edit does now, via a
  `revision` counter on the command manager.
- **State stores were untestable.** `vitest.config.ts` had no Svelte plugin,
  so constructing any runes class in a test threw `$state is not defined`.
  Fixed; the command manager and playback store have tests now, and the rest
  of the stores can.
- **Images on the main track.** A still exported as a single frame, or failed
  the filtergraph outright — `-t` shortens an input, it cannot extend one, and
  an image input has no audio stream for `[n:a]` to address. Stills are now
  looped at the export frame rate and given manufactured silence. This was the
  headline case: "put a video and an image, and that image will show for ten
  seconds at the start."
- **Dead account code.** `(auth)/login`, `(auth)/signup`, `LoginForm`,
  `SignupForm`, `api/auth.ts`, `api/client.ts`, `api/upload.ts`,
  `api/videos.ts` and `AuthStore` were all still shipping in the binary and
  reachable from nothing. A login page in an app whose README says there is
  no account was the complaint that started this.
- **The preview drew one track.** The export composited all of them, so an
  image over the opening seconds previewed as nothing and exported
  correctly. The preview now draws the layers above the base with the same
  ordering rules and the same geometry function as the filtergraph.

---

## 6. Not verified

- **macOS and Windows builds.** The CI matrix in
  `.github/workflows/desktop-release.yml` has never run. Apple and MSVC
  toolchains cannot cross-build from Linux.
- **Code signing.** Unsigned builds warn on launch.
- **The web build's editor** has had far less exercise than the desktop one,
  and projects are desktop-only.

---

## 6b. Still shipping, still dead

`(public)/share/[id]` and the eight components under `lib/components/share/`
are the other half of the account-era app: a public video page with
reactions, comments, a view counter, a transcript panel and an HLS player.
Nothing links to it, and every one of them fetches `/api/share/...`, which
does not exist in a static desktop build.

It was left in place rather than deleted with the auth code because it is a
coherent feature someone might want back, not a stray page. But it is ~30 KB
of the bundle doing nothing, and it should either be wired to something real
or removed.

---

## 7. Installer size

`.deb` installers are ~61 MB because the bundled ffmpeg and ffprobe are ~80 MB
each before compression. Dropping ffprobe from `BINARIES` in
`apps/desktop/scripts/fetch-ffmpeg.mjs` roughly halves that.

**This looks worse than it did.** The note used to say the only cost was an
approximate probe. Since then the width and height ffprobe reports became
load-bearing: they are what lets a reopened project stream-copy instead of
re-encoding. `ffmpeg -i` prints the same numbers, but as free text whose shape
varies by build and codec, and a misparse there does not fail loudly — it
silently costs minutes per export. Worth doing, but it needs the parser to be
tested against real output from several containers first, not written from
memory of the format.
