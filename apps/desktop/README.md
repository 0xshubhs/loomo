# Loomo Desktop

The Tauri 2 shell that turns the SvelteKit app into a native, installable
program — the same UI, but with the real FFmpeg binary behind it, an offline
project library, and screen capture that doesn't depend on `getDisplayMedia`.

```
apps/desktop/
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs         plugin + command registration, shutdown handling
│   │   ├── scratch.rs     real-disk stand-in for ffmpeg.wasm's MEMFS
│   │   ├── ffmpeg.rs      native ffmpeg exec, progress streaming, cancel
│   │   ├── capture.rs     x11grab / avfoundation / gdigrab screen capture
│   │   └── projects.rs    offline project + media library
│   ├── binaries/          loomo-ffmpeg / loomo-ffprobe sidecars (fetched, not committed)
│   ├── tauri.conf.json    window, CSP, and bundle targets
│   └── icons/             generated from icons/source.png
└── scripts/
    ├── fetch-ffmpeg.mjs   downloads static sidecars per target triple
    └── make-icon.mjs      renders the 1024×1024 source icon
```

## Runtime codecs (Linux)

The app's webview is WebKitGTK, which decodes media through GStreamer rather
than shipping its own codecs. Without `gstreamer1.0-libav` there is no H.264,
HEVC or AAC decoder, so **every MP4 looks unplayable to the editor** — and the
import path then tries to "fix" it by transcoding to H.264, which cannot help
and used to exhaust memory on the way to failing.

The `.deb` declares these now, so a normal install pulls them in. Running from
a build tree does not, so install them once:

```bash
sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly
```

Check with `gst-inspect-1.0 avdec_h264` — if that errors, MP4 will not play.

## Prerequisites

Rust (stable), Bun, and — on Linux only — the WebKitGTK development headers:

```bash
sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev libxdo-dev libssl-dev librsvg2-dev \
  libayatana-appindicator3-dev patchelf build-essential pkg-config file
```

macOS needs Xcode command line tools; Windows needs the MSVC build tools and
WebView2 (preinstalled on Windows 11).

## Running it

```bash
make desktop-setup   # once: fetch ffmpeg sidecars, generate icons
make desktop-dev     # dev build with hot reload
make desktop-build   # release installers
```

Installers appear under `src-tauri/target/release/bundle/`.

## What each platform produces

| Host | Formats |
|------|---------|
| Linux | `.deb`, `.rpm`, `.AppImage` |
| macOS | `.dmg`, `.app` |
| Windows | `.exe` (NSIS), `.msi` |

**You cannot cross-build these.** Apple's tooling only runs on macOS and the
MSVC toolchain only on Windows, so a single machine can only produce its own
platform's installers. To get all of them from one action, push a `v*` tag and
let `.github/workflows/desktop-release.yml` fan out across the three runners.

## How it differs from the web build

| | Web | Desktop |
|---|---|---|
| FFmpeg | ffmpeg.wasm, fetched from a CDN | native binary, bundled |
| Export speed | wasm-bound | full native speed |
| Max file size | capped by the wasm heap | disk |
| Screen capture | `getDisplayMedia` | ffmpeg, with browser fallback |
| Projects | server | `<app data>/projects/`, offline |
| Saving a render | browser download | native Save dialog |

The frontend is the *same* SvelteKit source. `svelte.config.js` swaps
`adapter-node` for `adapter-static` when `LOOMO_DESKTOP=1`, and
`createFFmpegEngine()` picks the native engine when it detects Tauri. Nothing
in the editor knows which one it got.

## Known limits

- **Wayland.** Native capture uses x11grab, which sees only Xwayland clients
  under Wayland. The app detects this, falls back to the browser recorder, and
  shows the reason. Proper portal/PipeWire capture is the fix and isn't done.
- **Pause.** Native capture can't pause — ffmpeg has no pause, and faking it
  by splitting into segments risks a seam at every join. The pause control is
  hidden in that mode; the browser recorder still pauses normally.
- **Screen + camera** stays on the browser recorder, since compositing the
  camera bubble needs a live canvas.
- **Installer size.** The bundled ffmpeg and ffprobe are ~80 MB each before
  compression, which dominates the ~61 MB `.deb`. Dropping ffprobe from
  `BINARIES` in `fetch-ffmpeg.mjs` roughly halves that, at the cost of the
  accurate metadata probe.
- **Reading a finished recording** pulls the whole file into a Blob so it can
  feed the existing post-record UI. Fine for normal clips, wasteful for very
  long ones; streaming it through `asset://` instead is the obvious next step.

## Why the sidecars are named `loomo-ffmpeg`

Tauri installs sidecars next to the main executable, which in a `.deb` is
`/usr/bin`. A sidecar plainly named `ffmpeg` therefore lands on
`/usr/bin/ffmpeg`, which Debian's own `ffmpeg` package owns — dpkg reports a
file conflict and refuses to install. The `loomo-` prefix keeps them ours.
Rename in three places if you ever change it: `fetch-ffmpeg.mjs`,
`bundle.externalBin` in `tauri.conf.json`, and the `.sidecar("…")` calls.

## Licensing

The sidecars come from
[`eugeneware/ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) and
are **GPL** builds. Shipping them means the distributed application must comply
with the GPL. If Loomo needs to stay proprietary, swap the fetch script over to
LGPL builds (for example BtbN's `*-lgpl` artifacts) and drop the GPL-only
encoders. `FFMPEG-LICENSE.txt` is saved next to the binaries.

## Code signing

Unsigned builds work but warn on launch — Gatekeeper on macOS, SmartScreen on
Windows. The release workflow picks up signing automatically if you set the
`APPLE_*` secrets. Windows signing needs a certificate wired into the
`bundle.windows.certificateThumbprint` config.
