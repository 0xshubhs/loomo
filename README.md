# Loomo

A multi-track video editor. Runs as a native desktop app on Linux, macOS and
Windows, and in the browser with reduced capability.

Projects live in your own app-data folder. There is no account, nothing is
uploaded, and the editor works with no network at all.

```
apps/web/         SvelteKit 5 frontend — project library, editor, share
apps/desktop/     Tauri 2 shell — native FFmpeg, offline projects, installers
apps/backend/     Go API + workers — transcode, thumbnails, transcription
apps/extension/   Chrome extension (Manifest V3)
packages/shared/  Shared types and constants
```

**Stack:** SvelteKit 2 + Svelte 5 (runes) · Tauri 2 (Rust) · Go (Chi, pgx,
sqlc, River) · PostgreSQL · Redis · Cloudflare R2 / MinIO · FFmpeg · HLS.js

---

## Quick start

### Web

```bash
bun install
make dev          # web + backend + docker infra
```

### Desktop

```bash
sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev libxdo-dev libssl-dev librsvg2-dev \
  libayatana-appindicator3-dev patchelf build-essential pkg-config file

make desktop-setup   # once: fetch ffmpeg sidecars, generate icons
make desktop-dev     # hot-reload dev build
make desktop-build   # release installers
```

Installers land in `apps/desktop/src-tauri/target/release/bundle/`.

**Linux also needs media codecs.** The `.deb` declares them, but a build tree
does not:

```bash
sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly
```

Verify with `gst-inspect-1.0 avdec_h264`. Without it nothing MP4 will play.

---

## Building installers

| Host | Produces |
|------|----------|
| Linux | `.deb`, `.rpm`, `.AppImage` |
| macOS | `.dmg`, `.app` |
| Windows | `.exe` (NSIS), `.msi` |

**These cannot be cross-built.** Apple's toolchain only runs on macOS and MSVC
only on Windows. Push a `v*` tag and
`.github/workflows/desktop-release.yml` fans out across three runners.

---

## Features

### Projects
The app opens on a library of projects, each stored in its own folder under
the OS app-data directory. Saving copies every clip into the project, so it
still opens after you have moved, renamed or deleted whatever you originally
imported — the copy happens in Rust, straight from the scratch directory the
import already wrote, so nothing large passes through JavaScript in either
direction.

Autosave writes about every half minute of continuous editing — throttled
from the first unsaved change rather than debounced, so a long session is the
case it fires in rather than the case it never reaches. It skips an untouched
editor, so backing out of "New project" leaves nothing behind. Leaving with
unsaved changes still asks: "Don't save" has to stay an explicit choice.

Waveforms and markers are saved with the project. Media that cannot be found
when a project opens is named in the editor rather than logged to a console
nobody is reading.

### Editing
Multi-track timeline, trim, split, transitions, 12 filter presets plus 8
manual adjustments, crop, rotate/flip, chroma key, PiP positioning, groups,
silence removal, AI voiceover, auto-captions.

**Every track reaches the export.** Images and audio placed on their own
tracks are composited over the base render — an image held over the opening
seconds appears exactly where it was placed, and a music bed is mixed in
rather than dropped.

**Images work on the main track too.** A still is looped into a real video
stream at the export frame rate and given a silent audio track, so a title
card sitting before the footage holds for its full length and concatenates
with clips that have sound.

**Clip speed** — presets from 0.25x to 4x plus a slider. Changing speed
retimes the clip and ripples the rest of the track, and the panel shows the
resulting timeline duration, so a 76s clip at 1.5x reads as 51s.

**Markers** — `M` drops a named point at the playhead, `Shift+M` removes one,
`Alt+←`/`Alt+→` walk between them. Clips snap to them, so a cut can be marked
while watching and made afterwards. Right-click the ruler to rename.

**Keyframes** — nine animatable properties (position X/Y, scale, rotation,
opacity, volume, brightness, contrast, saturation) with five easings.

**Speed curves** — multi-point ramps with a log-scale graph and presets.

**Mosaic** — pixelate or blur regions, optionally time-limited.

**Right-click** anywhere on the timeline for what applies there: split, trim
to playhead, duplicate, detach audio, delete on a clip; close this gap, the
track's gaps, or all gaps on empty space; add tracks on blank area.

### Media library
Local import, Pexels photos and video, Giphy, and a **music and sound-effects
library** via Openverse. Audio defaults to CC0 only; an opt-in tier adds CC BY
and the required credit is stored with the asset and surfaced at export.
Licences that forbid commercial use or derivatives are never requested.

### Export
MP4, WebM, MKV, AVI, MOV, GIF, M4A up to 4K. Native FFmpeg on the desktop,
ffmpeg.wasm on the web. Progress shows a stage, a projected time remaining
and elapsed time, and the finished file goes wherever you choose through a
real Save dialog.

Bitrate follows the resolution (4K 35 Mbps down to 480p 2.5 Mbps), scaling
uses lanczos, and the dialog says so when the chosen resolution is above the
source — upscaling 720p footage to 4K makes the file larger, not sharper.

**Match clip loudness** is on by default. Each clip is measured with EBU R128
and corrected with a fixed gain, capped by its true peak so reaching the
target never causes clipping. Clips cut together routinely differ by 10 dB,
and reproducing that faithfully is what makes half a video sound broken.

---

## Architecture notes

### One editor, two engines

`FFmpegEngine` (`apps/web/src/lib/engine/ffmpeg-engine.ts`) is the seam.
`FFmpegBridge` runs ffmpeg.wasm in a worker for the web;
`NativeFFmpegEngine` drives the bundled binary on the desktop.
`createFFmpegEngine()` picks by detecting Tauri.

The editor was written against ffmpeg.wasm's MEMFS, so it passes bare virtual
filenames. Natively we give FFmpeg a real scratch directory and set its
working directory there — the same argv works untouched.

### The preview does not use the webview's video player

This is the most important design decision in the desktop app, and it was
forced. On Linux the webview failed three different ways on one machine:

- WebKitGTK composited `<video>` as solid black on a hybrid NVIDIA GPU
- disabling DMABuf to fix that dropped it to software compositing far too
  slow to edit against
- ordinary MP4s intermittently wedged the element at `readyState 0`, with no
  error on either side

Decoding is unaffected by any of this — `drawImage` returns correct pixels
even when the element shows black, which is why thumbnails always worked. So
the preview decodes with the bundled FFmpeg and paints onto a canvas: a
realtime-paced MJPEG stream during playback, single-frame decodes while
scrubbing. Audio is extracted as PCM and played through Web Audio, resynced
when it drifts past 0.3s. The media element holds no remaining responsibility.

### Keyframes compile to FFmpeg expressions

Curves become nested `if(lt(t,…),…)` expressions evaluated per frame —
`eval=frame` on `eq`/`scale`/`volume`, expressions on `rotate` and `overlay`.
Opacity has no expression-capable filter, so it rides a generated `sendcmd`
script instead. Expressions are always single-quoted; FFmpeg reads an
unquoted comma as a filter separator and the graph fails.

Preview and export are separate renderers, so every effect is implemented
twice. A miniature FFmpeg-expression evaluator in the tests asserts the two
agree; without it they drift and the only symptom is an export that quietly
differs from what you approved.

Multi-track compositing is the same story. Audio too: the export mixes every
audio track, and the preview used to play only the base clip, so a music bed
was in the file and not in the editor. The preview used to paint the
first video track's active clip and nothing else, while the export
composited every other track on top — so an image held over the opening
seconds previewed as nothing and exported correctly, which is the worst way
round. The preview now draws the layers above the base onto its overlay
canvas, in the same order, and the pixel geometry comes from the same
`overlayGeometry` the filtergraph uses rather than from a second
implementation of it.

---

## Testing

```bash
cd apps/web && bun run test     # ~1098 tests
cd apps/web && bun run check    # typecheck, expects 0 errors
cd apps/desktop/src-tauri && cargo test
```

FFmpeg-backed integration tests run the real binary — building filtergraphs,
encoding actual MP4s and probing them with ffprobe. They skip automatically
when no binary is present.

---

## Things that will bite you

Every one of these cost real debugging time. They are documented because the
symptoms point somewhere other than the cause.

**A clip had no lower bound on the timeline.** Dragged left from the start it
kept going, sliding off the left edge and reading as though the clip were
being cropped — in fact it had a negative `timelineStart`. The trim handles
were unbounded in both directions too: the start handle would set a negative
`sourceStart` (ffmpeg cannot seek before the beginning, so it starts at zero
and everything after is out), and the end handle would run past the last frame
the media has or trim the clip to a negative length. The rules live in
`clip-bounds.ts` and are enforced in the commands, not just the drag handler,
so a keyboard nudge cannot reach somewhere a drag may not. A group is clamped
as a unit — clamping members individually stops the leftmost at zero and lets
the rest keep sliding.

**No pitch-preserving stretch in FFmpeg hits an exact length.** `atempo` loses
a fixed 20–27ms per instance and `rubberband` 55–70ms, both at the tail and
both regardless of input length — a window flush, so no slice size avoids it.
A sliced speed curve came out 192ms short over six seconds. The fix is to feed
each slice past its own span and trim the result back, so the surplus is real
neighbouring audio rather than silence; the final slice has no neighbour to
borrow from and is padded instead. Measured: 0.037ms out over six seconds.
`asetrate` + `aresample` needs none of this — it is sample-exact — but shifts
pitch, which is what physically happens when footage is sped up, so a curve's
`preservePitch` flag chooses between them.

**Speed-curve audio follows the curve slice by slice.** The video retimes with
a `setpts` expression; audio has no expression-driven equivalent, so the curve
is cut into constant-rate slices fine enough that the difference is inaudible.
Slice lengths come from the difference of the same closed-form integral the
`setpts` expression uses, so they telescope to exactly the video's length
whatever the slicing. Cuts are laid left to right taking the longest step that
stays in tolerance — bisection cannot reach the sizes a steep slow section
needs, and left the first tenth of a 0.25x ramp 14.7ms out.

**Silence detection runs in ffmpeg, not in the page.** `silencedetect`
streams the file and prints the regions to its log, so nothing but text comes
back. Decoding to an AudioBuffer first is the same ~40MB per minute that broke
preview audio, and it made the feature unusable on any real recording. The
parser was checked against output captured from the bundled binary rather than
written from the documentation.

**Preview audio is extracted a window at a time.** Decoding a whole clip did
not survive a real file: a 50-minute source produced a 536 MB WAV, read back
through the IPC in one piece and expanded by `decodeAudioData` into a 1.07 GB
float buffer — about 2.5 GB peak for one clip, with a cache that held three.
The app was OOM-killed with the status line still reading "Extracting audio".
Windows are 30s, two are held, and length stops mattering.

**`-ss` before `-i` is fast and lands somewhere else.** Measured on a 978 MB
MKV: 23368 of 32000 bytes differed from an accurate seek. The usual hybrid
(`-ss near -i file -ss remainder`) is no better — it adds a fixed offset to an
input seek that was already inexact. Preview audio seeks accurately (`-ss`
after `-i`), which costs ~0.5ms per second of source, and prefetches far
enough ahead to hide it. Consecutive windows extracted this way were verified
to join sample-exactly.

**WebKitGTK percent-decodes filenames in `<input type="file">`.** A file
genuinely named `Members%20Only%20S2.mp4` — which is what a browser download of
a URL-encoded link leaves on disk — is reported to the page as
`Members Only S2.mp4`. Nothing exists under that name, so the element returns a
`File` of **zero bytes with no error**. The import wrote an empty scratch copy
and ffmpeg said `moov atom not found`, which reads as a corrupt source when the
source is perfectly fine. The desktop uses the native dialog and imports by
path; Rust copies the file and the name never round-trips through the webview.

**WebKitGTK does not forward `console.*` to stderr.** Frontend logs are
invisible from a terminal. Diagnostics route through a Tauri command to
stderr and `~/.local/share/com.loomo.desktop/diagnostics.log`.

**A Tauri channel is a JSON transport.** Raw byte payloads sent over one never
arrive, silently. Frames are base64.

**`preload="auto"` wedges WebKitGTK** on large blob URLs — `readyState 0`,
`networkState 2`, forever, no error. Use `preload="metadata"`.

**`dragDropEnabled` must stay false.** wry installs its own drop handler on
the webview and swallows the file drop before the page's HTML5 `drop` fires.

**Native `<select>` ignores CSS `color` on GTK.** Without `appearance: none`
every dropdown renders unreadable.

**Nothing marked the project dirty on an edit.** `markDirty` was reached only
by the project-name field and the aspect-ratio picker, so trimming, splitting
and dragging clips all left the project looking saved — the leave prompt never
appeared for the case it exists for. The command manager carries a `revision`
counter now, because stack lengths cannot stand in for it: undoing back to an
empty stack is still a project that differs from the file.

**`.svelte.ts` modules need the Svelte plugin to be testable.** Without it a
runes state class throws `$state is not defined` the moment a test constructs
one, which is why none of the stores had tests. `vitest.config.ts` loads the
plugin now.

**A wasm constraint applied to the native engine is the recurring bug.** The
export refused a 474 MB file (ffmpeg.wasm's heap limit), encoded 4K with
`-preset ultrafast -threads 1 -b:v 5000k` (chosen to keep that heap small),
and rebuilt every source in webview memory. None of it applies to a real
binary. `FFmpegEngine` now declares `maxInputBytes` and `persistentStore`,
and the pipeline asks rather than assumes.

**`-t` shortens an input; it cannot extend one.** `ffmpeg -i photo.png -t 10`
is one frame, not ten seconds. A still needs `-loop 1 -framerate <fps> -t
<duration>`, and a silent `anullsrc` alongside it — an image input has no
audio stream, so `[n:a]` is a graph error rather than silence.

**`Clip.opacity` runs 0–1; `ClipFilters.opacity` runs 0–100.** Same codebase.
Reading the first as a percentage drew every composited overlay at 1% alpha,
which is indistinguishable from compositing not happening.

**A reopened project's `File` is empty on purpose.** Its bytes stay on disk —
materialising a gigabyte to satisfy the type would defeat the point — but
probing that placeholder for a resolution returned zeros, "unknown" meant
"scale anyway", and every export from a reopened project took the re-encode
path instead of a stream copy. Correct output, minutes of work for a copy.
The dimensions recorded at import travel with the asset now.

**`amix` defaults to `normalize=1`,** which divides every input by the input
count — adding one music track halves the original audio.

**Sidecars are named `loomo-ffmpeg`.** Tauri installs them beside the binary,
which in a `.deb` is `/usr/bin` — a sidecar called `ffmpeg` collides with the
distro package and dpkg refuses the install.

**An effect that reads and writes the same `$state` kills the whole UI.**
Svelte throws `effect_update_depth_exceeded` and tears down the effect tree;
everything silently stops re-rendering. Wrap the write in `untrack`.

**Decode pacing must match consumption.** Decoding preview frames faster than
realtime overruns the queue, trimming discards the oldest frames — exactly the
ones due next — and playback freezes after about a second.

---

## Licensing

The bundled FFmpeg builds are **GPL**. Distributing Loomo with them means
complying with the GPL. For a proprietary build, switch
`apps/desktop/scripts/fetch-ffmpeg.mjs` to LGPL builds and drop the GPL-only
encoders.

Openverse audio is Creative Commons. The default tier is CC0 (no attribution);
the opt-in tier adds CC BY, whose credit is tracked per asset and shown at
export.
