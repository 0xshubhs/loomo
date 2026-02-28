# VE-0xshubhs

A browser-based video editor. No server, no uploads, no accounts — everything runs locally in your browser using FFmpeg.wasm.

![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=flat&logo=svelte&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg.wasm-007808?style=flat&logo=ffmpeg&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

## Features

- **Multi-track timeline** — canvas-rendered, drag to move, edge-drag to trim
- **Split, trim, move** clips with full undo/redo (Ctrl+Z / Ctrl+Y)
- **Any video format** — MP4, MKV, AVI, MOV, WebM, FLV, WMV, TS (HEVC/ProRes auto-transcoded on import)
- **Audio playback** — native HTML5 video audio with per-track volume/mute
- **Text overlays** — customizable font, color, position, timing
- **Transitions** — fade, dissolve, wipe, cross-zoom
- **Export** — MP4/WebM/MKV with configurable resolution, bitrate, codec
- **Keyboard-driven** — full shortcut support (Space, S, T, Delete, etc.)
- **Privacy-first** — zero network requests, all processing in-browser via Web Worker

## Quick Start

```bash
# Clone
git clone https://github.com/0xshubhs/videoeditor.git
cd videoeditor

# Install
bun install

# Run
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome, Brave, or Edge.

## Usage

See [USAGE.md](./USAGE.md) for the full usage guide — importing media, editing clips, keyboard shortcuts, exporting, and troubleshooting.

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | SvelteKit (Svelte 5 runes) |
| Video processing | FFmpeg.wasm in Web Worker |
| State | `$state`, `$derived`, `$effect` |
| Undo/Redo | Command pattern with atomic transactions |
| Timeline | Canvas 2D (HiDPI) |
| Preview | Native `<video>` elements + canvas text overlay |
| Language | TypeScript |

## Architecture

```
Browser (Main Thread)              Browser (Web Worker)
+--------------------+             +------------------+
|  Svelte 5 UI       |             |  FFmpeg.wasm     |
|  +- State (runes)  |  messages   |  +- Transcode    |
|  +- Commands       |<----------->|  +- Export       |
|  +- Playback       |             |  +- Thumbnails   |
|  +- Canvas render  |             +------------------+
+--------------------+
```

Session-based — all state lives in memory. Nothing persists after closing the tab.

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome | Full support |
| Brave | Full support |
| Edge | Full support |
| Firefox | Limited (no SharedArrayBuffer by default) |
| Safari | Not supported |

Requires Cross-Origin Isolation headers (COOP/COEP) for SharedArrayBuffer. These are configured automatically in dev mode.

## Development

```bash
bun run dev          # Start dev server
bun run build        # Production build
bun run preview      # Preview production build
bun run check        # Type checking
```

## License

MIT
