# What's left

State as of the last push. Written down so none of it has to be rediscovered.

---

## 1. AI tools — infrastructure is done, models are not wired

`apps/web/src/lib/ai/` is complete and tested (199 tests): ONNX runtime
adapter, model registry, download cache with integrity checking, tensor
preprocessing, background removal, upscale, colorize. `AiToolsPanel.svelte`
exists.

**It cannot run inference yet.** Three things block it:

### 1a. `onnxruntime-web` is not installed
One dependency:
```bash
bun add --cwd apps/web onnxruntime-web
```
Then in `apps/web/vite.config.ts` add `optimizeDeps.exclude: ['onnxruntime-web']`,
copy its `.wasm`/`.mjs` artefacts into `apps/web/static/`, and keep the
COOP/COEP headers if multi-threaded wasm is wanted. No code in `lib/ai`
changes — `runtime.ts` picks it up through a dynamic import.

### 1b. Half the model URLs are dead — **verified, not guessed**
```
200  github.com/danielgatis/rembg/.../u2netp.onnx        cutout, works
200  github.com/danielgatis/rembg/.../u2net.onnx         cutout, works
200  huggingface.co/briaai/RMBG-1.4/.../model.onnx       cutout, works
401  huggingface.co/Xenova/real-esrgan-x2plus/...        repo does not exist
401  huggingface.co/Xenova/real-esrgan-x4plus/...        repo does not exist
401  huggingface.co/Xenova/colorizer-siggraph17/...      repo does not exist
```
So **background removal can ship first**; upscale and colorize need real
repos. Candidates found on HuggingFace, none inspected yet:
`imgdesignart/realesrgan-x4-onnx`, `Meeperomi/RealESRGAN_x4-onnx`,
`bukuroo/RealESRGAN-ONNX`, `Faridzar/manga-colorization-v2-onnx`.
Check each has an `.onnx` file, then fix the URL and the input/output tensor
names in `model-registry.ts`.

### 1c. Every `sha256` in the registry is `null`
`ModelCache` therefore reports `verified: false` and the UI says so. Download
each model once, hash it, pin the digest. The verify-and-reject path is
already written and tested — it just has nothing to compare against.

### 1d. `AiToolsPanel` is not mounted
It takes `getFrame` / `onResult` props deliberately, so it does not touch the
timeline. Add it to `PropertiesPanel.svelte` and supply a function that
returns the current preview frame as `ImageData`.

**Also unverified:** tensor input/output names (the u2netp output name
`'1959'` especially), Real-ESRGAN's fixed 256 input size (real exports are
usually dynamic-axis), and whether the colorizer emits 256×256 or 64×64 ab
channels. Fallbacks exist for renamed inputs/outputs, but these are guesses
until a model actually loads.

---

## 2. Still missing from VN parity

- **Project templates** — VN ships ~150. Nothing exists.
- **BeatsClips** — auto-cut to music beats. Needs onset detection; no
  foundation yet.
- **Masks** — shape/gradient masks per clip. Not started.
- **Motion tracking** — VN does not have it either, but the mosaic feature
  would be far more useful with it.

---

## 3. Known rough edges

- **Markers** — `M` is bound in the keyboard map and wired to nothing.
- **Mosaic regions** are slider-driven only. They should be draggable on the
  preview; the annotation layer now proves that interaction works and could
  be reused.
- **Speed curve audio** is stretched by the *average* rate, so long ramps
  drift. Exact variable-rate audio needs per-segment resampling.
- **Native capture on Wayland** falls back to the browser recorder. Real fix
  is a PipeWire/portal path.
- **Preview audio** decodes the whole clip to an AudioBuffer (~40MB per
  minute). Fine for clips, wasteful for long sources; should stream.
- **Dashboard** calls `/api/videos` on the desktop, where no backend exists,
  and logs a `SyntaxError` on every launch. Harmless but it pollutes the log
  and should be skipped when `isDesktop()`.

---

## 4. Not verified by me

- **macOS and Windows builds.** Apple and MSVC toolchains cannot cross-build;
  the CI matrix in `.github/workflows/desktop-release.yml` is written but has
  never run.
- **Code signing.** Unsigned builds warn on launch — Gatekeeper on macOS,
  SmartScreen on Windows. The workflow picks up `APPLE_*` secrets if set.
- **The web build's editor** has had far less exercise than the desktop one.

---

## 5. Worth doing before anything else

`.deb` installers are ~61MB because the bundled ffmpeg and ffprobe are ~80MB
each before compression. Dropping ffprobe from `BINARIES` in
`apps/desktop/scripts/fetch-ffmpeg.mjs` roughly halves that; the only cost is
the accurate metadata probe, which `ffmpeg -i` can approximate.
