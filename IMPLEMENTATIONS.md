# DITTOO — Implementation Overview

A Loom-style screen recorder with instant sharing, built as a monorepo with SvelteKit frontend, Go backend, and Chrome extension.

---

## Architecture

```
videoeditor/
├── apps/web/          SvelteKit frontend (recorder, editor, dashboard, share)
├── apps/backend/      Go API server + video processing workers
├── apps/extension/    Chrome extension (Manifest V3)
├── packages/shared/   Shared TypeScript types & constants
├── docker/            Docker Compose infrastructure
├── dev.sh             One-command dev startup script
└── Makefile           Build & dev commands
```

**Tech stack:** SvelteKit 2 + Svelte 5 (runes) · Go (Chi, pgx, sqlc, River) · PostgreSQL · Redis · Cloudflare R2/MinIO · FFmpeg.wasm · HLS.js

---

## Frontend — `apps/web/`

### Screen Recorder Engine

| File | Purpose |
|------|---------|
| `src/lib/recorder/media-stream-manager.ts` | Manages `getDisplayMedia` / `getUserMedia` for screen, camera, mic streams. Requests native resolution (up to 4K), 48kHz audio. |
| `src/lib/recorder/canvas-compositor.ts` | Canvas-based compositing for screen+camera mode. Draws screen at full captured resolution, overlays circular camera bubble with shadow and white border. Outputs via `captureStream(30)`. |
| `src/lib/recorder/recording-session.ts` | Orchestrates the full recording lifecycle: permissions → countdown → MediaRecorder → stop. H.264 preferred codec, 12Mbps bitrate for 1080p, 5s timeslice. Audio merging via AudioContext for mic+system audio. Generates thumbnail on stop. |

**Recording modes:** Screen+Camera · Screen Only · Camera Only
**Quality presets:** 1080p (12Mbps) · 720p (6Mbps) · 480p (3Mbps)

### Download Format Conversion

Post-recording download offers three formats via a dropdown picker:

- **WebM** — instant download (original recording)
- **MP4** (H.264/AAC) — client-side conversion via FFmpeg.wasm
- **MOV** (H.264/AAC) — client-side conversion via FFmpeg.wasm

Conversion runs in a Web Worker (`ffmpeg-worker.ts`) with progress tracking. Falls back to WebM if conversion fails.

### Video Editor (existing)

Full client-side video editor with FFmpeg.wasm:

| Module | Files |
|--------|-------|
| **Engine** | `ffmpeg-bridge.svelte.ts`, `ffmpeg-worker.ts`, `export-pipeline.ts`, `command-queue.ts`, `media-import.ts`, `preview-renderer.ts`, `thumbnail-generator.ts`, `waveform-generator.ts` |
| **Timeline** | `timeline-engine.ts`, `timeline-renderer.ts`, `interaction-handler.ts`, `playhead-controller.ts`, `snap-engine.ts`, `zoom-controller.ts` |
| **Playback** | `playback-engine.ts`, `frame-scheduler.ts`, `audio-mixer.ts` |
| **Commands** | `command-manager.svelte.ts`, `base-command.ts`, `clip-commands.ts`, `track-commands.ts`, `audio-commands.ts`, `text-commands.ts`, `transition-commands.ts`, `transaction.ts` |

### State Management (Svelte 5 Runes)

| Store | Purpose |
|-------|---------|
| `recorder.svelte.ts` | Recording state machine, device enumeration, camera bubble position |
| `auth.svelte.ts` | JWT auth state, login/signup/logout, token refresh |
| `dashboard.svelte.ts` | Video list, search, pagination, sort |
| `project.svelte.ts` | Editor project state |
| `timeline.svelte.ts` | Timeline tracks, clips, selection |
| `playback.svelte.ts` | Playback position, play/pause |
| `media-library.svelte.ts` | Imported media assets |
| `selection.svelte.ts` | Selected clips/tracks |
| `ui.svelte.ts` | UI panels, modals, preferences |
| `context.ts` | Svelte context injection for AppContext + EditorContext |

### Components

**Recorder** (6 components):
- `RecordLayout.svelte` — state machine view switcher (pre → countdown → recording → done)
- `PreRecordPanel.svelte` — mode selection, device pickers, quality selector, animated UI
- `CountdownOverlay.svelte` — fullscreen 3-2-1 countdown
- `FloatingControls.svelte` — glass-blur bottom bar with pause/stop/timer
- `CameraBubble.svelte` — draggable circular camera preview overlay
- `PostRecordPanel.svelte` — video preview, stats, title input, upload, format picker download

**Dashboard** (1 component):
- `DashboardLayout.svelte` — search bar, responsive video grid, skeleton loading, rename/delete modals

**Share Page** (7 components):
- `ShareLayout.svelte` — two-column layout (video + sidebar)
- `HlsPlayer.svelte` — HLS.js adaptive player with raw video fallback + "HD processing" badge
- `VideoInfo.svelte` — title, author, date display
- `ReactionBar.svelte` — 6 emoji reactions with optimistic updates and floating animation
- `CommentsPanel.svelte` — timestamped comments with localStorage name persistence
- `CommentItem.svelte` — single comment display
- `ViewCounter.svelte` — view tracking, fires POST on mount
- `TranscriptPanel.svelte` — synced transcript display

**Auth** (2 components):
- `LoginForm.svelte` — email + password login
- `SignupForm.svelte` — name + email + password signup

**Editor** (14 components):
- Layout: `EditorLayout.svelte`, `TopBar.svelte`, `StatusBar.svelte`
- Timeline: `TimelinePanel.svelte`, `TimelineCanvas.svelte`, `TimelineToolbar.svelte`, `TrackHeader.svelte`
- Media: `MediaBrowser.svelte`, `MediaCard.svelte`, `ImportDropZone.svelte`
- Preview: `PreviewPanel.svelte`, `TransportControls.svelte`
- Properties: `PropertiesPanel.svelte`, `ClipProperties.svelte`, `TextEditor.svelte`, `AudioMixer.svelte`, `TransitionPicker.svelte`
- Export: `ExportDialog.svelte`, `ExportProgress.svelte`
- Shared: `Button.svelte`, `Dropdown.svelte`, `Icon.svelte`, `Modal.svelte`, `Slider.svelte`, `Tooltip.svelte`

### Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | `(app)` CSR | Dashboard — video grid with search |
| `/record` | `(app)` CSR | Screen recorder |
| `/edit/[id]` | `(app)` CSR | Video editor |
| `/login` | `(auth)` CSR | Login page |
| `/signup` | `(auth)` CSR | Signup page |
| `/share/[id]` | `(public)` SSR | Public share page with OG meta tags |

**Route groups:** `(app)` has `ssr = false` for client-side rendering. `(public)` uses SSR for social previews/SEO.

### API Client

| File | Purpose |
|------|---------|
| `api/client.ts` | Base fetch wrapper with JWT auto-refresh on 401 |
| `api/auth.ts` | Signup, login, refresh token endpoints |
| `api/videos.ts` | CRUD: create, list, get, update, delete, complete upload |
| `api/upload.ts` | Direct upload to presigned R2/MinIO URL with progress |

### Utilities

| File | Purpose |
|------|---------|
| `utils/time.ts` | `formatRecordingTime()`, `relativeTime()`, duration formatting |
| `utils/clipboard.ts` | `copyToClipboard()` |
| `utils/debounce.ts` | Generic debounce function |
| `utils/file.ts` | File size formatting, type detection |
| `utils/id.ts` | Nanoid-based ID generation |
| `utils/keyboard.ts` | Keyboard shortcut handling |
| `utils/math.ts` | Clamp, lerp, snap utilities |

### Types

`recorder.ts` · `auth.ts` · `dashboard.ts` · `timeline.ts` · `media.ts` · `project.ts` · `audio.ts` · `effects.ts` · `export.ts` · `commands.ts`

---

## Backend — `apps/backend/`

### API Server (`cmd/api/main.go`)

Go HTTP server using Chi router. Connects to PostgreSQL, Redis, and S3-compatible storage (R2/MinIO).

**Middleware stack:** CORS · Rate limiting · Request ID · Structured logging (zerolog) · JWT auth

### API Endpoints

```
POST   /api/auth/signup         Email + password signup
POST   /api/auth/login          Login → JWT access + refresh tokens
POST   /api/auth/refresh        Refresh token rotation

POST   /api/videos              Create video + get presigned upload URL
GET    /api/videos              List user's videos (paginated)
GET    /api/videos/:id          Video metadata + streaming URLs
PATCH  /api/videos/:id          Update title, description, share mode
DELETE /api/videos/:id          Soft delete
POST   /api/videos/:id/complete Finalize upload, trigger processing jobs

GET    /api/share/:id           Public video data (SSR + client)
POST   /api/share/:id/view      Record view
GET    /api/share/:id/reactions  Get reactions
POST   /api/share/:id/reactions  Add reaction
GET    /api/share/:id/comments   Get comments
POST   /api/share/:id/comments   Add comment

GET    /api/health              Health check
```

### Database (PostgreSQL + sqlc)

**Migrations** (9 total):

| Migration | Tables |
|-----------|--------|
| 001 | `users` — id, email, name, password_hash, avatar, OAuth provider |
| 002 | `refresh_tokens` — token hash, expiry, user FK |
| 003 | `videos` — status enum (uploading/processing/ready/failed), share mode (public/unlisted/private), S3 keys, duration |
| 004 | `processing_jobs` — job type (transcode/thumbnail/transcribe), status, progress |
| 005 | River job queue tables |
| 006 | `video_views` — IP-based unique view tracking |
| 007 | `reactions` — emoji reactions per video |
| 008 | `comments` — timestamped comments with author name |
| 009 | `view_count` column on videos |

**sqlc queries** (7 files): `users.sql` · `refresh_tokens.sql` · `videos.sql` · `processing_jobs.sql` · `video_views.sql` · `reactions.sql` · `comments.sql`

### Handlers

| File | Responsibility |
|------|----------------|
| `handler/handler.go` | Handler struct, dependency injection |
| `handler/auth.go` | Signup (bcrypt), login, JWT issuance, refresh rotation |
| `handler/video.go` | CRUD, presigned URL generation, upload completion, share endpoint |
| `handler/social.go` | Views, reactions, comments |

### Middleware

| File | Responsibility |
|------|----------------|
| `middleware/auth.go` | JWT validation, user context extraction |
| `middleware/logger.go` | Structured request/response logging |
| `middleware/ratelimit.go` | IP-based rate limiting |
| `middleware/requestid.go` | X-Request-ID header injection |

### Video Processing Workers (`cmd/worker/main.go`)

Background job processor using River (PostgreSQL-based queue).

| Worker | Purpose |
|--------|---------|
| `worker/transcode.go` | FFmpeg HLS transcoding — source → adaptive bitrate M3U8 + TS segments |
| `worker/thumbnail.go` | Extract frame at 2s → JPEG thumbnail |
| `worker/transcribe.go` | Audio extraction → OpenAI Whisper API → transcript |
| `worker/dispatcher.go` | Enqueues all 3 jobs transactionally on upload complete |
| `worker/ffmpeg.go` | FFmpeg command execution wrapper |
| `worker/jobs.go` | River job type definitions |
| `worker/migrate.go` | River schema migration |

### Storage

| File | Purpose |
|------|---------|
| `storage/r2.go` | S3-compatible client for R2/MinIO — presigned URLs, upload, download, HLS key management |

### Config

| File | Purpose |
|------|---------|
| `config/config.go` | Environment variable loading via envconfig |

---

## Chrome Extension — `apps/extension/`

Manifest V3 Chrome extension for recording from any tab.

| File | Purpose |
|------|---------|
| `manifest.json` | Permissions: `desktopCapture`, `tabCapture`, `activeTab`, `storage` |
| `popup.html/js/css` | Extension popup UI — start recording, settings |
| `background.js` | Service worker — manages recording state, tab capture |
| `content.js` | Injected recording widget using Shadow DOM isolation |
| `content.css` | Widget styles (inside Shadow DOM) |
| `recorder.js` | MediaRecorder wrapper for the extension context |
| `uploader.js` | Upload recorded blob to DITTOO API |

---

## Infrastructure

### Docker Compose (`docker/docker-compose.yml`)

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 17 | 5432 | Primary database |
| Redis 7 | 6379 | Caching, rate limiting |
| MinIO | 9000/9001 | S3-compatible object storage (local R2) |

### Dev Script (`dev.sh`)

Single command to start everything:

```bash
./dev.sh
```

- Checks prerequisites (bun, go, docker)
- Starts Docker infrastructure (waits for PostgreSQL health)
- Creates MinIO bucket
- Installs npm dependencies
- Starts SvelteKit dev server (port 5173)
- Starts Go API server (port 8080)
- Color-coded log output with graceful Ctrl+C shutdown

### Makefile

```
make dev          Start everything (infra + web + backend)
make dev-web      SvelteKit only
make dev-backend  Go API only
make dev-infra    Docker services only
make build        Build web + backend
make test         Type check + Go tests
make db-migrate   Run SQL migrations
make db-reset     Drop and recreate database
make sqlc         Regenerate Go code from SQL
make clean        Stop containers, remove build artifacts
```

---

## Upload & Playback Flow

1. User records in browser → WebM blob
2. `POST /api/videos` → creates DB record, returns presigned PUT URL
3. Client uploads blob directly to R2/MinIO (bypasses API server)
4. `POST /api/videos/:id/complete` → triggers 3 River jobs (transcode, thumbnail, transcribe)
5. **Instant playback:** Share page serves raw video immediately
6. Workers process in background → HLS segments, thumbnail, transcript
7. Share page polls every 5s → swaps raw video for HLS when ready
8. HLS.js handles adaptive bitrate streaming

---

## Key Technical Decisions

- **No auth required for local dev** — auth guard removed from app layout
- **COOP/COEP headers only on `/edit/*`** — required for SharedArrayBuffer (FFmpeg.wasm multithreading), but would break OAuth and share pages elsewhere
- **H.264 preferred over VP9** — better real-time encoding quality, wider compatibility
- **Canvas compositor for screen+cam** — `captureStream(30)` composites screen + circular camera overlay into single MediaRecorder input
- **FFmpeg.wasm for download conversion** — WebM recording converted client-side to MP4/MOV, no server round-trip needed
- **River over Redis for job queue** — PostgreSQL-based, transactional enqueue, one less infrastructure dependency
- **sqlc over ORM** — type-safe Go from raw SQL, zero runtime overhead
- **Direct R2 upload** — presigned URLs, no API server bandwidth bottleneck
