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

Known gaps:

- **No autosave.** Leaving asks; a crash loses the edit.
- **Reopened assets carry an empty `File`.** Nothing on the desktop path reads
  it — ffmpeg works from the staged scratch copy — but `probeVideoResolution`
  falls back to "unknown", which pushes the export onto the re-encode strategy
  instead of stream copy. Correct output, slower than it needs to be.
- **Waveforms are not saved**, so an audio clip reopens without its waveform.
- **A missing media file is skipped with a console warning.** It should be
  visible in the UI.

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

- **Markers** — `M` is in the keyboard map and wired to nothing.
- **Mosaic regions** are slider-driven; they should be draggable on the
  preview. The annotation layer proves that interaction works.
- **Speed-curve audio** is stretched by the *average* rate, so long ramps
  drift. Exact variable-rate audio needs per-segment resampling.
- **The preview has not been checked against multi-track compositing.** The
  exported file is verified by tests that sample real pixels; whether the
  preview canvas draws overlay tracks the same way is unknown.
- **Preview audio** decodes a whole clip to an AudioBuffer (~40 MB/minute).

---

## 6. Not verified

- **macOS and Windows builds.** The CI matrix in
  `.github/workflows/desktop-release.yml` has never run. Apple and MSVC
  toolchains cannot cross-build from Linux.
- **Code signing.** Unsigned builds warn on launch.
- **The web build's editor** has had far less exercise than the desktop one,
  and projects are desktop-only.

---

## 7. Worth doing first

`.deb` installers are ~61 MB because the bundled ffmpeg and ffprobe are ~80 MB
each before compression. Dropping ffprobe from `BINARIES` in
`apps/desktop/scripts/fetch-ffmpeg.mjs` roughly halves that; the only cost is
the accurate metadata probe, which `ffmpeg -i` can approximate.
