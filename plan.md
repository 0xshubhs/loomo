# DITTOO — Complete Loom Clone Blueprint
## Zero-Tolerance Engineering Spec: Every Service, Every Pixel, Every Bitrate

---

## TABLE OF CONTENTS

1. Loom's Verified Tech Stack
2. Full System Architecture
3. Recording Engine (All Clients)
4. Video Quality & Encoding Pipeline (Exact Loom Match)
5. HLS + DASH Streaming & Custom Player
6. Transcription & AI Pipeline
7. Sharing, Embedding & oEmbed
8. Collaboration Engine
9. Video Editor (Transcript-Based)
10. Dashboard, Library & Workspaces
11. Analytics & Viewer Tracking
12. Integrations
13. Screenshot Tool
14. Meeting Recorder
15. Authentication & Security
16. Complete Database Schema
17. Complete API Design
18. Infrastructure & Deployment
19. Performance Engineering
20. Scalability Playbook
21. Cost Model
22. Team & Timeline

---

## 1. LOOM'S VERIFIED TECH STACK

Sources: Himalayas tech stack page, Vercel case study, Atlassian engineering blog, Loom developer docs, Loom support docs, Braintrust case study.

### Languages & Frameworks

| Layer | Loom Uses | Dittoo Uses |
|---|---|---|
| Frontend (Marketing + Share Pages) | Next.js on Vercel | Next.js 14+ on Vercel |
| Frontend (Dashboard/App) | React + TypeScript | React + TypeScript |
| Chrome Extension | TypeScript, Manifest V3 | TypeScript, Manifest V3 |
| Desktop App | Electron + bundled FFmpeg + native C++ recording layers | Electron + bundled FFmpeg + native capture |
| Backend API | Node.js + Go | Node.js (Fastify) + Go |
| Video Processing | FFmpeg + C++ | FFmpeg + Go workers |
| ML/AI | Python, TensorFlow, PyTorch | Python, TensorFlow |
| Data Pipeline | Python, dbt, Airflow | Python, dbt, Airflow |

### Infrastructure

| Component | Loom Uses | Dittoo Uses |
|---|---|---|
| Cloud | AWS | AWS |
| Orchestration | Kubernetes + Helm | Kubernetes (EKS) + Helm |
| IaC | Terraform | Terraform |
| CI/CD | CircleCI + GitHub Actions | GitHub Actions |
| CDN | Fastly | Fastly |
| Database | PostgreSQL | PostgreSQL (RDS) |
| Data Warehouse | Snowflake | Snowflake |
| Frontend Hosting | Vercel | Vercel |
| Containers | Docker | Docker |
| Object Storage | AWS S3 | AWS S3 |

### Monitoring & Analytics

| Component | Loom Uses | Dittoo Uses |
|---|---|---|
| Error Tracking | Sentry | Sentry |
| Infra Monitoring | Datadog | Datadog |
| Product Analytics | Amplitude + Segment | Amplitude + Segment |
| BI | Tableau | Tableau |
| Web Analytics | Google Analytics + Matomo | Google Analytics |

### AI

| Component | Loom Uses | Dittoo Uses |
|---|---|---|
| Auto-titles/summaries/chapters | OpenAI (confirmed: transcript sent as text) | OpenAI API |
| Eval Framework | Braintrust | Braintrust |
| Body Segmentation | TensorFlow / MediaPipe | TensorFlow.js + MediaPipe |

---

## 2. FULL SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                    │
│                                                                         │
│  Chrome Extension    Desktop App       Mobile App       Web Dashboard  │
│  (TS, MV3)          (Electron+FFmpeg)  (React Native)   (Next.js+React)│
│  ┌──────────┐       ┌──────────────┐   ┌──────────┐    ┌────────────┐ │
│  │getDisplay │       │ Native APIs  │   │ Camera + │    │ Library    │ │
│  │Media()    │       │ + System     │   │ Screen   │    │ Player     │ │
│  │getUserMed │       │   Audio      │   │ Record   │    │ Editor     │ │
│  │ia()       │       │ + 4K capture │   │          │    │ Analytics  │ │
│  │tabCapture │       │ + HLS mux    │   │          │    │ Settings   │ │
│  └─────┬─────┘       └──────┬───────┘   └────┬─────┘    └─────┬──────┘ │
│        │                    │                 │               │         │
│        └────────────────────┼─────────────────┼───────────────┘         │
│                             │                 │                         │
└─────────────────────────────┼─────────────────┼─────────────────────────┘
                              │ Upload chunks   │
                              ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FASTLY CDN                                      │
│  • HLS/DASH segment caching    • Thumbnail/GIF edge caching            │
│  • Share page edge caching      • Global POPs                          │
│  • SSL termination at edge      • Cache invalidation API               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│                         API GATEWAY (Kong on EKS)                       │
│  • JWT validation    • Rate limiting (token bucket, per-user + per-IP) │
│  • Request routing   • WebSocket upgrade for real-time features        │
│  • CORS              • Request/response logging → Datadog              │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│                    MICROSERVICES (Kubernetes / EKS)                      │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐            │
│  │ RECORDING      │  │ VIDEO          │  │ TRANSCRIPTION  │            │
│  │ ORCHESTRATOR   │  │ PROCESSING     │  │ SERVICE        │            │
│  │ (Node.js)      │  │ (Go + FFmpeg)  │  │ (Python)       │            │
│  │                │  │                │  │                │            │
│  │ • Receive HLS  │  │ • Stitch       │  │ • Whisper GPU  │            │
│  │   chunks       │  │ • Transcode    │  │ • Word-level   │            │
│  │ • S3 multipart │  │   360/720/     │  │   timestamps   │            │
│  │ • Crash recov  │  │   1080/4K      │  │ • VTT gen      │            │
│  │ • Instant link │  │ • HLS package  │  │ • 50+ langs    │            │
│  │ • Status WS    │  │ • DASH package │  │ • Speaker      │            │
│  │                │  │ • Thumbnails   │  │   diarization  │            │
│  │                │  │ • GIF gen      │  │                │            │
│  │                │  │ • Watermark    │  │                │            │
│  └────────┬───────┘  └────────┬───────┘  └────────┬───────┘            │
│           │                   │                    │                    │
│  ┌────────▼───────┐  ┌───────▼────────┐  ┌────────▼───────┐           │
│  │ AI SERVICE     │  │ SHARING &      │  │ COLLABORATION  │           │
│  │ (Python)       │  │ PERMISSIONS    │  │ ENGINE         │           │
│  │                │  │ (Node.js)      │  │ (Node.js)      │           │
│  │ • Auto-title   │  │                │  │                │           │
│  │ • Auto-summary │  │ • Link gen     │  │ • Comments     │           │
│  │ • Auto-chapters│  │ • ACL engine   │  │ • Reactions     │           │
│  │ • AI workflows │  │ • Password     │  │ • Tasks/CTAs   │           │
│  │ • Text-to-     │  │ • Expiry       │  │ • @mentions    │           │
│  │   speech       │  │ • Download     │  │ • Threads      │           │
│  │ • Video        │  │   control      │  │ • Email notif  │           │
│  │   variables    │  │ • Embed/oEmbed │  │                │           │
│  │ • Filler word  │  │ • OG tags      │  │                │           │
│  │   detection    │  │                │  │                │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │ ANALYTICS      │  │ USER &         │  │ NOTIFICATION   │           │
│  │ SERVICE (Go)   │  │ WORKSPACE      │  │ SERVICE        │           │
│  │                │  │ (Node.js)      │  │ (Node.js)      │           │
│  │ • View track   │  │                │  │                │           │
│  │ • Engagement   │  │ • Auth (JWT)   │  │ • Email (SES)  │           │
│  │ • Heatmaps     │  │ • Teams/Roles  │  │ • Push         │           │
│  │ • CTA clicks   │  │ • SSO/SCIM     │  │ • In-app       │           │
│  │ • Export CSV   │  │ • Branding     │  │ • Slack        │           │
│  │ • Segment +    │  │ • Data retain  │  │ • Webhooks     │           │
│  │   Amplitude    │  │ • Billing      │  │                │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐                                │
│  │ INTEGRATION    │  │ MEETING        │                                │
│  │ SERVICE        │  │ RECORDER       │                                │
│  │ (Node.js)      │  │ (Python +      │                                │
│  │                │  │  Playwright)   │                                │
│  │ • Slack        │  │                │                                │
│  │ • Jira         │  │ • Cal sync     │                                │
│  │ • Confluence   │  │ • Bot join     │                                │
│  │ • Gmail        │  │ • Capture      │                                │
│  │ • Notion       │  │ • Auto-recap   │                                │
│  │ • Zapier       │  │ • Action items │                                │
│  └────────────────┘  └────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────────┐
│                         DATA LAYER                                      │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ PostgreSQL   │  │ Redis        │  │ AWS S3       │  │ Snowflake  │ │
│  │ (RDS)        │  │ (ElastiCache)│  │              │  │            │ │
│  │              │  │              │  │ • Raw video  │  │ • Warehouse│ │
│  │ • Users      │  │ • Sessions   │  │ • HLS .ts    │  │ • dbt      │ │
│  │ • Videos     │  │ • Cache      │  │ • DASH .m4s  │  │ • Airflow  │ │
│  │ • Transcripts│  │ • Pub/Sub    │  │ • Thumbnails │  │ • Tableau  │ │
│  │ • Comments   │  │ • Rate limit │  │ • GIFs       │  │            │ │
│  │ • Workspaces │  │ • Job queues │  │ • Screenshots│  │            │ │
│  │ • Analytics  │  │ • Live state │  │ • .m3u8/.mpd │  │            │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐                                    │
│  │Elasticsearch │  │ SQS / BullMQ │                                    │
│  │              │  │              │                                    │
│  │ • Full-text  │  │ • Transcode  │                                    │
│  │   transcript │  │   jobs       │                                    │
│  │   search     │  │ • AI jobs    │                                    │
│  │ • Video meta │  │ • Notif jobs │                                    │
│  │   search     │  │ • Event bus  │                                    │
│  └──────────────┘  └──────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. RECORDING ENGINE (ALL CLIENTS)

### 3.1 Chrome Extension

Loom's SDK architecture (confirmed from dev.loom.com): a TypeScript module for UI injected into a shadow DOM, plus a hidden iFrame served from the Loom domain that handles all business logic via PostMessage.

**Recording flow (exactly matching Loom):**

```
User clicks extension icon
         │
         ▼
┌────────────────────────────────┐
│  PRE-RECORD PANEL (Shadow DOM)│
│                                │
│  Recording Mode:               │
│  ┌──────┐ ┌──────┐ ┌────────┐│
│  │Screen │ │Screen│ │ Camera ││
│  │+ Cam  │ │ Only │ │  Only  ││
│  └──────┘ └──────┘ └────────┘│
│                                │
│  Screen Source:                │
│  ┌───────────┐ ┌────────────┐│
│  │Full Screen │ │  Window    ││
│  └───────────┘ └────────────┘│
│  ┌───────────────────────────┐│
│  │  Custom Size (drag)       ││
│  └───────────────────────────┘│
│                                │
│  Camera: [dropdown]            │
│  Mic:    [dropdown]            │
│  Quality: Auto / 720p / 1080p  │
│                                │
│  Camera Shape:                 │
│  ○ Circle  ○ Square  ○ Full   │
│                                │
│  ☐ Speaker Notes               │
│  ☐ Drawing Tools               │
│  ☐ Click Highlighting          │
│                                │
│  [  Start Recording  ]        │
└────────────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  COUNTDOWN: 3... 2... 1...    │
│  (CSS animation overlay)       │
└────────────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  ACTIVE RECORDING              │
│                                │
│  ┌──────────────────────────┐ │
│  │ Screen capture stream     │ │
│  │ (getDisplayMedia)         │ │
│  │                           │ │
│  │    ┌─────────┐            │ │
│  │    │ Camera  │            │ │
│  │    │ bubble  │ (draggable)│ │
│  │    └─────────┘            │ │
│  └──────────────────────────┘ │
│                                │
│  Recording Controls (floating):│
│  [⏸ Pause] [🔄 Restart]       │
│  [✏️ Draw] [🗑 Cancel]         │
│  [⏹ Stop]   ⏱ 00:03:42       │
│                                │
│  Speaker Notes (separate       │
│  panel, NOT captured):         │
│  ┌──────────────────────────┐ │
│  │ Your notes appear here   │ │
│  │ Scrollable teleprompter  │ │
│  └──────────────────────────┘ │
└────────────────────────────────┘
         │
         ▼  (MediaRecorder → chunks → upload)
         │
┌────────────────────────────────┐
│  POST-RECORD PREVIEW           │
│                                │
│  ┌──────────────────────────┐ │
│  │ Video preview playback    │ │
│  └──────────────────────────┘ │
│                                │
│  Title: [editable field]       │
│                                │
│  [📋 Copy Link]  [✂️ Trim]    │
│  [🔄 Re-record]  [🗑 Delete]  │
│                                │
│  Link: dittoo.com/share/abc123 │
│  ✅ Copied to clipboard!       │
└────────────────────────────────┘
```

**Capture implementation:**

```typescript
// screen-capture.ts — Chrome Extension
async function startCapture(options: CaptureOptions): Promise<MediaStream> {
  const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: options.width },       // up to 1920 for extension
      height: { ideal: options.height },      // up to 1080 for extension
      frameRate: { ideal: 30, max: 30 },
      displaySurface: options.source,         // 'monitor' | 'window' | 'browser'
    },
    audio: true,  // Tab audio (chrome.tabCapture for system audio)
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
  });

  let cameraStream: MediaStream | null = null;
  if (options.cameraEnabled) {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 640 },
        facingMode: 'user',
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,   // Browser-level noise suppression
        autoGainControl: true,
      },
    });
  }

  return compositeStreams(screenStream, cameraStream, options);
}
```

**Compositor (Canvas-based, exactly like Loom):**

```typescript
// compositor.ts — merges screen + camera into single stream
function compositeStreams(
  screen: MediaStream,
  camera: MediaStream | null,
  options: CaptureOptions
): MediaStream {
  const canvas = new OffscreenCanvas(options.width, options.height);
  const ctx = canvas.getContext('2d')!;

  const screenVideo = new VideoFrame(screen.getVideoTracks()[0]);

  // Draw loop at 30fps
  const interval = setInterval(() => {
    // 1. Draw screen frame (full canvas)
    ctx.drawImage(screenVideoElement, 0, 0, options.width, options.height);

    // 2. Draw camera bubble (if enabled)
    if (camera && options.cameraEnabled) {
      const bubble = options.cameraBubble;
      ctx.save();

      if (bubble.shape === 'circle') {
        // Circular clip path
        ctx.beginPath();
        ctx.arc(
          bubble.x + bubble.size / 2,
          bubble.y + bubble.size / 2,
          bubble.size / 2,
          0, Math.PI * 2
        );
        ctx.clip();
      }

      // Apply virtual background if enabled
      if (options.virtualBackground) {
        drawWithBackgroundRemoval(ctx, cameraVideoElement, bubble);
      } else {
        ctx.drawImage(cameraVideoElement, bubble.x, bubble.y, bubble.size, bubble.size);
      }

      ctx.restore();

      // Camera frame/border
      drawCameraFrame(ctx, bubble, options.cameraFrame);
    }

    // 3. Draw annotations (pen, arrows, highlights)
    if (drawingLayer.hasContent()) {
      ctx.drawImage(drawingLayer.canvas, 0, 0);
    }

    // 4. Draw click highlights
    if (options.clickHighlight && lastClick) {
      drawClickRipple(ctx, lastClick.x, lastClick.y, lastClick.age);
    }
  }, 1000 / 30);

  return canvas.captureStream(30);
}
```

### 3.2 Desktop App (Electron + FFmpeg)

Loom confirmed (Atlassian blog): Electron with native OS recording APIs + bundled FFmpeg for client-side HLS muxing. The desktop app eliminated the need for server-side recording servers by moving transmuxing to the client.

**Key differences from extension:**

| Feature | Chrome Extension | Desktop App |
|---|---|---|
| Max resolution | 1080p | 4K (3840x2160) |
| System audio | Tab audio only (chrome.tabCapture) | Full system audio (macOS: virtual audio driver, Windows: WASAPI loopback) |
| Camera bubble | Stays within browser tab | Follows across all apps (separate transparent window) |
| Output format | WebM VP9 → DASH | MP4 H.264 → HLS |
| Click highlighting | Limited | Full native cursor tracking |
| Drawing tools | Canvas overlay in tab | Transparent window overlay across screen |
| Custom size | CSS-based selection | Native OS region selection |
| Encoding | MediaRecorder API | FFmpeg hardware-accelerated encoding |

**Desktop windowing system (matching Loom's architecture from their blog):**

Loom uses independent windows per component, managed by a centralized middleware where windows can only be modified as side effects of actions. Their blog describes a custom-size recording triggering 14 window updates from 3 interactions.

```typescript
// window-manager.ts — Centralized state machine
// Loom's rule: "A window can only be modified as a side effect 
// of another action, never directly"

interface WindowState {
  controlMenu: { visible: boolean; position: Point; size: Size };
  cameraBubble: { visible: boolean; position: Point; size: number; shape: string };
  customSizeSelector: { visible: boolean; region: Rect };
  speakerNotes: { visible: boolean; position: Point };
  drawingOverlay: { visible: boolean };
  preferences: { visible: boolean };
  countdown: { visible: boolean };
}

type WindowAction =
  | { type: 'START_CUSTOM_SIZE' }
  | { type: 'CONFIRM_REGION'; region: Rect }
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'TOGGLE_CAMERA' }
  | { type: 'TOGGLE_DRAWING' }
  | { type: 'PAUSE_RECORDING' }
  | { type: 'RESUME_RECORDING' }
  // ... 20+ more actions

function windowReducer(state: WindowState, action: WindowAction): WindowState {
  switch (action.type) {
    case 'START_CUSTOM_SIZE':
      return {
        ...state,
        preferences: { visible: false },
        customSizeSelector: { visible: true, region: state.customSizeSelector.region },
        controlMenu: { ...state.controlMenu, /* reposition */ },
      };
    case 'START_RECORDING':
      return {
        ...state,
        countdown: { visible: true },
        customSizeSelector: { visible: false },
        controlMenu: { ...state.controlMenu, /* minimize to recording toolbar */ },
        cameraBubble: { ...state.cameraBubble, visible: state.cameraEnabled },
      };
    // ... each action triggers multiple window side effects
  }
}
```

**Desktop HLS muxing (matching Loom's blog description):**

```typescript
// desktop-recorder.ts — Client-side HLS using bundled FFmpeg
// Loom bundles "a tiny part of FFmpeg" to convert OS-produced MP4 to HLS

async function startDesktopRecording(options: RecordingOptions) {
  // 1. Start native screen capture via OS APIs
  const screenCapture = await startNativeCapture({
    display: options.display,
    region: options.customRegion,
    fps: 30,
    resolution: options.quality,  // 720p / 1080p / 1440p / 4K
  });

  // 2. Start FFmpeg process for real-time HLS muxing
  const ffmpeg = spawn(FFMPEG_PATH, [
    '-f', 'rawvideo',
    '-pix_fmt', 'nv12',
    '-s', `${options.width}x${options.height}`,
    '-r', '30',
    '-i', 'pipe:0',                    // Video from native capture
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-i', 'pipe:3',                    // Audio (mic + system)
    '-c:v', 'h264_videotoolbox',       // macOS HW accel (or h264_nvenc on Windows)
    '-profile:v', 'high',
    '-level', '4.1',
    '-b:v', bitrateForResolution(options.quality),
    '-maxrate', maxBitrateForResolution(options.quality),
    '-bufsize', bufsizeForResolution(options.quality),
    '-g', '60',                        // Keyframe every 2s at 30fps
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-f', 'hls',
    '-hls_time', '6',                  // 6-second segments (HLS default)
    '-hls_list_size', '0',             // Keep all segments in playlist
    '-hls_segment_filename', `${tempDir}/segment_%05d.ts`,
    `${tempDir}/playlist.m3u8`,
  ]);

  // 3. Upload each .ts segment to S3 as it's created
  watchForNewSegments(tempDir, async (segmentPath) => {
    await uploadChunk(segmentPath, options.videoId);
    // Video is playable immediately — Loom's "uncompromising immediacy"
  });
}
```

### 3.3 System Audio Capture (Platform-Specific)

This is one of the hardest parts. Loom's blog confirms they use native machine resources for this.

**macOS:**
- Requires a virtual audio device (ScreenCaptureKit on macOS 13+ handles this natively)
- Pre-macOS 13: Bundle a signed audio plugin (kext or Audio Unit) similar to BlackHole
- ScreenCaptureKit provides `SCStream` with audio mixing of system + mic

**Windows:**
- WASAPI loopback capture captures system audio natively
- No driver needed — Windows API supports this out of the box
- Use `IAudioClient` in shared loopback mode

**Linux:**
- PulseAudio monitor source or PipeWire
- `pactl load-module module-loopback`

---

## 4. VIDEO QUALITY & ENCODING PIPELINE (EXACT LOOM MATCH)

### 4.1 Loom's Confirmed Video Specs

From Loom's support documentation:

**Recording Quality by Platform:**

| Platform | Free (Starter) | Paid (Business+) |
|---|---|---|
| Chrome Extension | Up to 720p | Up to 1080p |
| Desktop App (Mac) | Up to 720p | Up to 4K (3840x2160) |
| Desktop App (Windows) | Up to 720p | Up to 4K |
| Mobile (iOS/Android) | Up to 720p | Up to 1080p |
| Camera Only | Up to 720p | Up to 1080p (all platforms) |

**Loom's Encoding Format:**

| Property | Desktop App (Raw) | Chrome Extension |
|---|---|---|
| Container | MP4 | WebM |
| Video Codec | H.264 (High Profile) | VP9 |
| Audio Codec | AAC | Opus |
| Frame Rate | 30fps | 30fps |
| Streaming | HLS | DASH |

**Loom's Adaptive Streaming:**
- Desktop recordings: **HLS** (HTTP Live Streaming) with H.264/AAC in .ts segments
- Extension recordings: **DASH** (Dynamic Adaptive Streaming over HTTP) with VP9/Opus
- Player auto-selects highest quality the viewer's connection can support
- Downloads: Always .MP4 format (H.264/AAC)

### 4.2 Dittoo Encoding Pipeline (Exact Match)

**ABR Ladder — Matching Loom's multi-resolution transcoding:**

```
Source video (raw upload)
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│                    TRANSCODING WORKER (Go + FFmpeg)             │
│                                                                │
│  Input: Raw MP4/WebM from client                               │
│                                                                │
│  Step 1: Probe source                                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ ffprobe -v error -show_entries                            │ │
│  │   stream=width,height,bit_rate,codec_name,r_frame_rate   │ │
│  │   -of json input.mp4                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Step 2: Transcode to ABR ladder                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Resolution  │  Bitrate (video)  │  Bitrate (audio)       │ │
│  │─────────────│───────────────────│────────────────────────│ │
│  │ 360p        │  800 kbps         │  96 kbps AAC           │ │
│  │ 480p        │  1,400 kbps       │  128 kbps AAC          │ │
│  │ 720p        │  2,800 kbps       │  128 kbps AAC          │ │
│  │ 1080p       │  5,000 kbps       │  192 kbps AAC          │ │
│  │ 1440p       │  8,000 kbps       │  192 kbps AAC          │ │
│  │ 2160p (4K)  │  16,000 kbps      │  192 kbps AAC          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Step 3: Package for delivery                                  │
│  • HLS: .m3u8 master playlist + .ts segments (6s each)        │
│  • DASH: .mpd manifest + .m4s segments (4s each)              │
│  • Both reference same H.264 transcodes via CMAF fMP4         │
│                                                                │
│  Step 4: Generate assets                                       │
│  • Thumbnail: frame at 2s mark, 1280x720 JPEG                │
│  • GIF thumbnail: 3s loop at 320px, 10fps, 256 colors        │
│  • Poster: first frame, full resolution                       │
│  • Waveform: audio waveform data for visual timeline          │
└────────────────────────────────────────────────────────────────┘
```

**FFmpeg transcoding commands (production-grade):**

```bash
# Master transcode command — single-pass H.264 ABR ladder
ffmpeg -i input.mp4 \
  # 360p
  -map 0:v -map 0:a \
  -c:v:0 libx264 -profile:v:0 main -level:v:0 3.1 \
  -b:v:0 800k -maxrate:v:0 960k -bufsize:v:0 1600k \
  -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:-1:-1" \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a:0 aac -b:a:0 96k -ar 48000 \
  \
  # 720p
  -map 0:v -map 0:a \
  -c:v:1 libx264 -profile:v:1 main -level:v:1 3.1 \
  -b:v:1 2800k -maxrate:v:1 3360k -bufsize:v:1 5600k \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1" \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a:1 aac -b:a:1 128k -ar 48000 \
  \
  # 1080p
  -map 0:v -map 0:a \
  -c:v:2 libx264 -profile:v:2 high -level:v:2 4.1 \
  -b:v:2 5000k -maxrate:v:2 6000k -bufsize:v:2 10000k \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1" \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a:2 aac -b:a:2 192k -ar 48000 \
  \
  # HLS packaging
  -f hls \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_flags independent_segments \
  -hls_segment_type fmp4 \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  stream_%v/playlist.m3u8
```

**DASH packaging (for extension recordings):**

```bash
# DASH from the same transcodes
ffmpeg -i input.webm \
  # ... same transcode ladder ... \
  -f dash \
  -seg_duration 4 \
  -use_timeline 1 \
  -use_template 1 \
  -adaptation_sets "id=0,streams=v id=1,streams=a" \
  manifest.mpd
```

**Key encoding parameters (matching Loom's quality):**

```
┌───────────────────────────────────────────────────────────────┐
│  CRITICAL ENCODING SETTINGS FOR LOOM-QUALITY VIDEO           │
│                                                               │
│  Codec:           H.264 (libx264 or hardware accelerated)    │
│  Profile:         High (1080p+), Main (720p and below)       │
│  Level:           4.1 (1080p), 5.1 (4K)                     │
│  Pixel Format:    yuv420p (maximum compatibility)            │
│  Frame Rate:      30fps (constant, never variable)           │
│  GOP Size:        60 frames (2 seconds at 30fps)             │
│  B-Frames:        3 (for compression efficiency)             │
│  Reference Frames: 4                                          │
│  Keyframe Align:  Forced at segment boundaries               │
│  Rate Control:    Constrained VBR (CRF with maxrate cap)     │
│  CRF:            23 (balanced quality/size)                  │
│  Preset:          medium (balance encode speed vs quality)    │
│  Tune:            zerolatency (for processing speed)         │
│                                                               │
│  Audio:                                                       │
│  Codec:           AAC-LC                                      │
│  Sample Rate:     48,000 Hz                                  │
│  Channels:        Stereo (2ch) or Mono (1ch)                 │
│  Bitrate:         128-192 kbps                               │
│                                                               │
│  HLS Segment:     6 seconds (matching Apple default)         │
│  DASH Segment:    4 seconds                                  │
│  Container:       fMP4 (CMAF compatible)                     │
│  Subtitle:        WebVTT sidecar                             │
└───────────────────────────────────────────────────────────────┘
```

### 4.3 Hardware-Accelerated Encoding

**Client-side (Desktop App):**

| Platform | Encoder | API |
|---|---|---|
| macOS | `h264_videotoolbox` | VideoToolbox |
| Windows (NVIDIA) | `h264_nvenc` | NVENC |
| Windows (AMD) | `h264_amf` | AMF |
| Windows (Intel) | `h264_qsv` | Quick Sync |
| Linux (NVIDIA) | `h264_nvenc` | NVENC |

**Server-side (Transcode Workers):**

| Instance Type | Encoder | Speed vs CPU |
|---|---|---|
| AWS g5.xlarge (NVIDIA A10G) | `h264_nvenc` | ~15-30x faster |
| AWS g4dn.xlarge (NVIDIA T4) | `h264_nvenc` | ~10-20x faster |
| CPU fallback (c6i.2xlarge) | `libx264` | Baseline |

### 4.4 Thumbnail & GIF Generation

```bash
# Static thumbnail at 2-second mark
ffmpeg -i input.mp4 -ss 2 -vframes 1 \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1" \
  -q:v 2 thumbnail.jpg

# Animated GIF thumbnail (Loom shows these on hover)
ffmpeg -i input.mp4 -ss 1 -t 3 \
  -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];\
       [s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer" \
  thumbnail.gif

# GIF with camera bubble visible (like Loom's email embeds)
# This is just the regular GIF — camera is already composited in
```

### 4.5 Processing Pipeline Architecture

```
Recording completes → Upload finishes
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  JOB DISPATCHER (BullMQ + Redis)                        │
│                                                         │
│  Dispatches these jobs IN PARALLEL:                     │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ TRANSCODE   │  │ TRANSCRIBE  │  │ THUMBNAILS  │   │
│  │ Job         │  │ Job         │  │ Job         │   │
│  │             │  │             │  │             │   │
│  │ Priority: 1 │  │ Priority: 1 │  │ Priority: 0 │   │
│  │ Timeout: 30m│  │ Timeout: 10m│  │ Timeout: 2m │   │
│  │ Retries: 3  │  │ Retries: 3  │  │ Retries: 3  │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │            │
│         ▼                ▼                ▼            │
│  ┌─────────────┐  ┌─────────────┐  Thumbnails ready   │
│  │ HLS ready   │  │ Transcript  │  → Update video     │
│  │ → Video     │  │ ready       │    metadata          │
│  │   playable  │  │ → Trigger   │                     │
│  │             │  │   AI jobs   │                     │
│  └─────────────┘  └──────┬──────┘                     │
│                          │                             │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ AUTO-TITLE  │  │ AUTO-       │  │ AUTO-       │   │
│  │ Job         │  │ SUMMARY Job │  │ CHAPTERS Job│   │
│  │ (OpenAI)    │  │ (OpenAI)    │  │ (OpenAI)    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                         │
│  EACH JOB:                                              │
│  • Idempotent (safe to retry)                          │
│  • Reports progress via Redis pub/sub                  │
│  • Updates PostgreSQL on completion                    │
│  • Triggers webhook/notification on completion         │
└─────────────────────────────────────────────────────────┘
```

**Time targets (matching Loom's processing speed):**

| Step | Target Time (5-min video) |
|---|---|
| Chunk upload complete | Instant (uploaded during recording) |
| Thumbnail generated | < 5 seconds |
| GIF generated | < 10 seconds |
| Transcript ready | < 30 seconds (GPU Whisper) |
| 720p transcode ready | < 30 seconds (GPU) |
| 1080p transcode ready | < 45 seconds (GPU) |
| 4K transcode ready | < 90 seconds (GPU) |
| AI title/summary/chapters | < 15 seconds |
| Full processing complete | < 2 minutes |

---

## 5. HLS + DASH STREAMING & CUSTOM PLAYER

### 5.1 HLS Master Playlist (Example)

```m3u8
#EXTM3U
#EXT-X-VERSION:7

#EXT-X-STREAM-INF:BANDWIDTH=928000,RESOLUTION=640x360,CODECS="avc1.4d001f,mp4a.40.2"
stream_0/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1528000,RESOLUTION=854x480,CODECS="avc1.4d001f,mp4a.40.2"
stream_1/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2928000,RESOLUTION=1280x720,CODECS="avc1.4d001f,mp4a.40.2"
stream_2/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.640029,mp4a.40.2"
stream_3/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=16192000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2"
stream_4/playlist.m3u8
```

### 5.2 Custom Video Player (Matching Loom's Player)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                    VIDEO PLAYBACK AREA                       │
│                                                              │
│         (HLS.js adaptive bitrate streaming)                  │
│                                                              │
│                                                              │
│    [Emoji reactions float across during playback]            │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ▶ ━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  │  ▲ chapter   ▲ reaction  ▲ comment   ▲ chapter           │
│  │  markers     markers     markers     markers              │
│  │                                                           │
│  ├ 2:34 / 5:12    [0.5x] [1x] [1.5x] [2x]                 │
│  │                                                           │
│  ├ [CC] [Quality: Auto ▾]  [⛶ Theater]  [⛶ Fullscreen]     │
│  │       └─ Auto                                             │
│  │          360p                                             │
│  │          720p                                             │
│  │          1080p ✓                                          │
│  │          1440p                                            │
│  │          2160p (4K)                                       │
└──────────────────────────────────────────────────────────────┘

SIDEBAR (right):
┌──────────────────────┐
│ TRANSCRIPT           │
│ (synced, scrollable, │
│  clickable)          │
│                      │
│ 0:00 Hey everyone,  │
│      today I want   │
│      to show you... │
│                      │
│ 0:15 So first let's │  ← highlighted = current
│      open up the    │
│      dashboard...   │
│                      │
│ 0:32 And you can    │
│      see here that  │
│      the metrics... │
│                      │
│ [🔍 Search transcript]
└──────────────────────┘
```

**Player implementation:**

```typescript
// player.tsx — Custom Dittoo Player
import Hls from 'hls.js';
import dashjs from 'dashjs';

function DittooPlayer({ video }: { video: Video }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<'auto' | number>('auto');

  useEffect(() => {
    const el = videoRef.current!;

    if (video.streamingFormat === 'hls') {
      // Desktop app recordings → HLS
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1,        // Auto quality
          capLevelToPlayerSize: true,
          progressive: true,     // Start playing ASAP
        });
        hls.loadSource(video.hlsUrl);
        hls.attachMedia(el);
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        el.src = video.hlsUrl;
      }
    } else {
      // Chrome extension recordings → DASH
      const player = dashjs.MediaPlayer().create();
      player.initialize(el, video.dashUrl, false);
      player.updateSettings({
        streaming: {
          abr: { autoSwitchBitrate: { video: true } },
          buffer: { fastSwitchEnabled: true },
        },
      });
    }
  }, [video]);

  return (
    <div className="dittoo-player">
      <video ref={videoRef} />
      <PlayerControls video={video} />
      <ChapterMarkers chapters={video.chapters} />
      <ReactionOverlay reactions={video.reactions} />
      <QualitySelector levels={video.availableQualities} />
      <TranscriptSidebar transcript={video.transcript} />
    </div>
  );
}
```

---

## 6. TRANSCRIPTION & AI PIPELINE

### 6.1 Transcription

```python
# transcription_worker.py
import whisper
from whisper.utils import get_writer

async def transcribe_video(video_id: str, audio_path: str):
    model = whisper.load_model("large-v3", device="cuda")

    result = model.transcribe(
        audio_path,
        word_timestamps=True,       # Word-level timing
        language=None,              # Auto-detect (50+ languages)
        task="transcribe",
        verbose=False,
        condition_on_previous_text=True,
        fp16=True,                  # GPU acceleration
    )

    # Store word-level timestamps for transcript editing
    words = []
    for segment in result["segments"]:
        for word_info in segment.get("words", []):
            words.append({
                "word": word_info["word"],
                "start_ms": int(word_info["start"] * 1000),
                "end_ms": int(word_info["end"] * 1000),
                "confidence": word_info.get("probability", 1.0),
            })

    # Generate VTT subtitles
    vtt_writer = get_writer("vtt", str(Path(audio_path).parent))
    vtt_writer(result, audio_path)

    # Store in DB
    await save_transcript(video_id, result["text"], words, result["language"])

    # Upload VTT to S3
    await upload_vtt(video_id, vtt_path)

    # Trigger AI jobs
    await dispatch_ai_jobs(video_id, result["text"])
```

### 6.2 AI Features (Matching Loom's OpenAI Integration)

Loom confirmed: OpenAI receives transcript data as text files to generate titles, summaries, chapters.

```python
# ai_service.py
import openai

async def generate_auto_title(transcript: str) -> str:
    response = await openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "system",
            "content": """Generate a concise, descriptive video title (max 60 chars).
            Rules:
            - Focus on the main topic discussed
            - Use natural language, not clickbait
            - Include exactly one emoji at the end
            - No quotes around the title"""
        }, {
            "role": "user",
            "content": f"Video transcript (first 500 words):\n{transcript[:2000]}"
        }],
        max_tokens=100,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


async def generate_auto_summary(transcript: str) -> str:
    response = await openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "system",
            "content": """Generate a 2-3 sentence summary of this video.
            Focus on: what was discussed, key decisions or takeaways.
            Write in third person ("The presenter discusses...")"""
        }, {
            "role": "user",
            "content": f"Full transcript:\n{transcript[:8000]}"
        }],
        max_tokens=200,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


async def generate_auto_chapters(transcript: str, words: list) -> list:
    response = await openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "system",
            "content": """Analyze this timestamped transcript and identify 3-8 chapter breaks.
            Return JSON array: [{"title": "...", "start_ms": 0}, ...]
            Rules:
            - Each chapter title is 3-6 words
            - First chapter always starts at 0
            - Minimum chapter length: 30 seconds
            - Chapters mark genuine topic transitions"""
        }, {
            "role": "user",
            "content": f"Timestamped transcript:\n{format_timestamped(transcript, words)}"
        }],
        max_tokens=500,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)["chapters"]


async def ai_workflow_transform(transcript: str, target_format: str) -> str:
    """Loom's AI Workflows: transform video into text documents"""
    prompts = {
        "bug_report": "Convert this into a structured bug report with: Summary, Steps to Reproduce, Expected vs Actual Behavior, Environment.",
        "meeting_notes": "Convert this into meeting notes with: Attendees (if mentioned), Key Discussion Points, Decisions Made, Action Items.",
        "sop": "Convert this into a Standard Operating Procedure with: Purpose, Scope, Step-by-step Procedure, Notes.",
        "jira_ticket": "Convert this into a Jira ticket with: Summary, Description, Acceptance Criteria, Priority suggestion.",
        "slack_message": "Summarize this into a concise Slack message (under 300 words) with key points.",
    }

    response = await openai.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": prompts[target_format]
        }, {
            "role": "user",
            "content": transcript
        }],
        max_tokens=2000,
    )
    return response.choices[0].message.content
```

### 6.3 AI Eval Framework (Matching Loom's Braintrust Setup)

```python
# evals.py — Matching Loom's Braintrust-based evaluation
import braintrust

@braintrust.traced
def eval_auto_title(transcript: str, generated_title: str) -> dict:
    scores = {}

    # Deterministic scorers (Loom uses code-based where possible)
    scores["length_valid"] = 1.0 if len(generated_title) <= 60 else 0.0
    scores["has_emoji"] = 1.0 if any(is_emoji(c) for c in generated_title[-2:]) else 0.0
    scores["no_quotes"] = 1.0 if '"' not in generated_title else 0.0

    # LLM-based scorer for relevance
    scores["relevance"] = await llm_score_relevance(transcript, generated_title)

    return scores
```

---

## 7. SHARING, EMBEDDING & oEMBED

### 7.1 Share Page (Next.js SSR on Vercel)

Every video gets a URL: `dittoo.com/share/{videoId}`

```typescript
// app/share/[id]/page.tsx — Server Component
export async function generateMetadata({ params }): Promise<Metadata> {
  const video = await getVideo(params.id);
  return {
    title: video.title,
    description: video.summary,
    openGraph: {
      title: video.title,
      description: video.summary,
      type: 'video.other',
      images: [{ url: video.thumbnailUrl, width: 1280, height: 720 }],
      videos: [{ url: video.embedUrl, width: 1280, height: 720 }],
    },
    twitter: {
      card: 'player',
      title: video.title,
      description: video.summary,
      images: [video.thumbnailUrl],
      players: [{ playerUrl: video.embedUrl, width: 1280, height: 720 }],
    },
  };
}
```

### 7.2 oEmbed Endpoint

```json
// GET /api/oembed?url=https://dittoo.com/share/abc123
{
  "version": "1.0",
  "type": "video",
  "provider_name": "Dittoo",
  "provider_url": "https://dittoo.com",
  "title": "Q3 Product Demo 🚀",
  "author_name": "Jane Smith",
  "thumbnail_url": "https://cdn.dittoo.com/thumbs/abc123.jpg",
  "thumbnail_width": 1280,
  "thumbnail_height": 720,
  "html": "<iframe src=\"https://dittoo.com/embed/abc123\" width=\"640\" height=\"360\" frameborder=\"0\" allowfullscreen></iframe>",
  "width": 640,
  "height": 360
}
```

---

## 8-14. REMAINING SERVICES (Specs)

### 8. Collaboration Engine
- Timestamped comments (anchored to video timeline)
- Threaded replies, @mentions with email/Slack notification
- Emoji reactions (float across screen during playback, just like Loom)
- Tasks/CTAs generated from comments
- Auto call-to-action based on recorded webpage URL

### 9. Video Editor
- Edit by transcript: select text → delete → video segments removed
- Trim: in/out point cutting
- Stitch: insert new clips at any point
- Overlays: text, arrows, boxes (SVG rendered on player, FFmpeg burned on export)
- Blur: region-based with time range
- Filler word removal: detect "um", "uh" from transcript → auto-trim
- Live rewind: mid-recording rewind (rolling buffer, discard last N seconds)
- Text-to-speech: edit transcript text → regenerate voiceover via TTS API
- Video variables: dynamic title/audio placeholders for personalization at scale

### 10. Dashboard & Library
- Grid/list view with animated GIF thumbnails on hover
- Folders, Spaces, archiving
- Full-text search across titles, descriptions, transcripts (Elasticsearch)
- Tags for organization
- Workspace switching
- Custom branding (logo, player colors, remove Dittoo branding)
- Watch Later queue

### 11. Analytics
- Who watched (email identification, anonymous count)
- Watch percentage per viewer
- Engagement heatmap (which parts rewatched)
- CTA click tracking
- View timestamps
- Export to CSV
- Real-time view notifications ("Sarah just watched your video")
- Segment + Amplitude pipeline for product analytics
- Snowflake + dbt + Tableau for BI

### 12. Integrations
- Slack: unfurl links with video preview, Block Kit
- Gmail: Chrome extension adds "Insert Dittoo" button, embeds GIF thumbnail
- Jira: Atlassian Connect app, AI workflow → create ticket from video
- Confluence: embed as macro
- Notion: oEmbed auto-embed
- GitHub/GitLab: inline link expansion in PRs
- Google Drive: export videos
- Zapier: webhooks on video events
- Salesforce: integration for sales videos (Enterprise)

### 13. Screenshot Tool
- Capture via same screen capture APIs (single frame)
- Annotate: arrows, text, blur, crop (Fabric.js canvas)
- Share via link (same as videos)
- OCR for searchability (Tesseract)

### 14. Meeting Recorder
- Google Calendar + Outlook OAuth2 sync
- Headless browser bot (Playwright) joins Zoom/Meet/Teams
- Captures audio/video stream
- Processes through same pipeline
- Auto-generates recap with action items
- Push to Confluence/Notion/Slack

---

## 15. AUTHENTICATION & SECURITY

| Feature | Implementation |
|---|---|
| Login Methods | Email/password, Google OAuth, Slack OAuth, Apple Sign-In, SSO (SAML 2.0) |
| Session | JWT (access token: 15min, refresh token: 30 days) |
| SSO | SAML 2.0 for Enterprise (Okta, Azure AD, OneLogin) |
| SCIM | Directory sync for Enterprise user provisioning |
| Video Privacy | Public, Unlisted, Restricted (email/domain), Password-protected |
| Encryption | TLS 1.3 in transit, AES-256 at rest (S3 SSE) |
| SOC 2 | Type II compliance |
| Data Retention | Configurable per workspace (Enterprise) |

---

## 16. COMPLETE DATABASE SCHEMA

```sql
-- ==========================================
-- USERS & AUTH
-- ==========================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    avatar_url      TEXT,
    password_hash   TEXT,                    -- NULL if OAuth-only
    auth_provider   VARCHAR(50),             -- 'email', 'google', 'slack', 'apple'
    auth_provider_id VARCHAR(255),
    is_verified     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- WORKSPACES & TEAMS
-- ==========================================
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) UNIQUE NOT NULL,
    logo_url        TEXT,
    plan            VARCHAR(50) DEFAULT 'starter',  -- starter, business, business_ai, enterprise
    branding        JSONB DEFAULT '{}',     -- { primaryColor, logoUrl, removeBranding }
    sso_enabled     BOOLEAN DEFAULT FALSE,
    sso_config      JSONB,                  -- SAML settings
    scim_enabled    BOOLEAN DEFAULT FALSE,
    data_retention_days INTEGER,             -- NULL = forever
    download_enabled BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workspace_members (
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(50) DEFAULT 'member',  -- admin, creator, member, viewer
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE spaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    is_default      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- VIDEOS
-- ==========================================
CREATE TABLE videos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id),
    creator_id      UUID REFERENCES users(id),
    space_id        UUID REFERENCES spaces(id),
    folder_id       UUID REFERENCES folders(id),

    -- Metadata
    title           VARCHAR(500),
    description     TEXT,
    status          VARCHAR(50) DEFAULT 'processing',  -- uploading, processing, ready, failed
    duration_ms     INTEGER,
    recording_source VARCHAR(50),  -- 'chrome_extension', 'desktop_mac', 'desktop_windows', 'mobile', 'upload', 'meeting_bot'

    -- Source media
    source_url      TEXT,           -- S3 path to raw upload
    source_codec    VARCHAR(50),    -- 'h264', 'vp9'
    source_width    INTEGER,
    source_height   INTEGER,
    source_fps      REAL,
    source_bitrate  INTEGER,        -- kbps

    -- Processed media
    hls_url         TEXT,           -- S3 path to master.m3u8
    dash_url        TEXT,           -- S3 path to manifest.mpd
    download_url    TEXT,           -- S3 path to MP4 for download

    -- Thumbnails
    thumbnail_url   TEXT,
    gif_url         TEXT,
    poster_url      TEXT,
    custom_thumbnail_url TEXT,       -- User-uploaded thumbnail

    -- Sharing
    share_mode      VARCHAR(50) DEFAULT 'workspace',  -- public, unlisted, workspace, restricted, password
    password_hash   TEXT,
    allowed_emails  TEXT[],
    allowed_domains TEXT[],
    link_expiry     TIMESTAMPTZ,
    download_enabled BOOLEAN DEFAULT TRUE,
    requires_email  BOOLEAN DEFAULT FALSE,   -- Viewer must enter email

    -- CTA
    cta_text        VARCHAR(255),
    cta_url         TEXT,
    cta_timestamp_ms INTEGER,

    -- Recording context
    recorded_url    TEXT,            -- URL of page being recorded

    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    archived_at     TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_videos_workspace ON videos(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_creator ON videos(creator_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_status ON videos(status);

-- ==========================================
-- TRANSCRIPTS
-- ==========================================
CREATE TABLE transcripts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    language        VARCHAR(10) NOT NULL,    -- ISO 639-1
    full_text       TEXT NOT NULL,
    vtt_url         TEXT,                    -- S3 path to .vtt subtitle file
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transcript_words (
    id              BIGSERIAL PRIMARY KEY,
    transcript_id   UUID REFERENCES transcripts(id) ON DELETE CASCADE,
    word            VARCHAR(255) NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    confidence      REAL DEFAULT 1.0,
    is_filler       BOOLEAN DEFAULT FALSE    -- "um", "uh", "like"
);

CREATE INDEX idx_transcript_words_timing ON transcript_words(transcript_id, start_ms);

-- ==========================================
-- AI GENERATED CONTENT
-- ==========================================
CREATE TABLE ai_titles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    accepted        BOOLEAN DEFAULT FALSE,
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    summary         TEXT NOT NULL,
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_chapters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    start_ms        INTEGER NOT NULL,
    sort_order      INTEGER NOT NULL
);

-- ==========================================
-- COLLABORATION
-- ==========================================
CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id),
    parent_id       UUID REFERENCES comments(id),  -- For threads
    body            TEXT NOT NULL,
    timestamp_ms    INTEGER,                         -- Anchored to video time
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE reactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id),
    emoji           VARCHAR(10) NOT NULL,
    timestamp_ms    INTEGER NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id),
    comment_id      UUID REFERENCES comments(id),
    assignee_id     UUID REFERENCES users(id),
    title           TEXT NOT NULL,
    status          VARCHAR(50) DEFAULT 'open',  -- open, in_progress, done
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- ANALYTICS
-- ==========================================
CREATE TABLE video_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    viewer_user_id  UUID REFERENCES users(id),  -- NULL if anonymous
    viewer_email    VARCHAR(255),
    viewer_name     VARCHAR(255),
    watch_percentage REAL DEFAULT 0,
    total_watch_ms  INTEGER DEFAULT 0,
    cta_clicked     BOOLEAN DEFAULT FALSE,
    ip_address      INET,
    user_agent      TEXT,
    referrer        TEXT,
    watched_at      TIMESTAMPTZ DEFAULT NOW()
);

-- High-volume event table (consider ClickHouse/Snowflake for scale)
CREATE TABLE view_events (
    id              BIGSERIAL PRIMARY KEY,
    video_id        UUID NOT NULL,
    view_id         UUID NOT NULL,
    event_type      VARCHAR(50) NOT NULL,  -- play, pause, seek, progress, complete, cta_click
    timestamp_ms    INTEGER,               -- Position in video
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_view_events_video ON view_events(video_id, created_at);

-- ==========================================
-- ORGANIZATION
-- ==========================================
CREATE TABLE folders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    space_id        UUID REFERENCES spaces(id),
    name            VARCHAR(255) NOT NULL,
    parent_id       UUID REFERENCES folders(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    UNIQUE(workspace_id, name)
);

CREATE TABLE video_tags (
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    tag_id          UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
);

-- ==========================================
-- SCREENSHOTS
-- ==========================================
CREATE TABLE screenshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id),
    creator_id      UUID REFERENCES users(id),
    title           VARCHAR(500),
    original_url    TEXT,           -- S3 path to raw capture
    annotated_url   TEXT,           -- S3 path to annotated version
    width           INTEGER,
    height          INTEGER,
    ocr_text        TEXT,           -- Extracted text for search
    share_mode      VARCHAR(50) DEFAULT 'workspace',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- INTEGRATIONS
-- ==========================================
CREATE TABLE integrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,  -- slack, jira, gmail, notion, zapier
    config          JSONB NOT NULL,        -- OAuth tokens, webhook URLs
    enabled         BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhooks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    events          TEXT[] NOT NULL,  -- ['video.created', 'video.viewed', 'comment.created']
    secret          TEXT NOT NULL,
    enabled         BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 17. KEY API ENDPOINTS

```
AUTH
  POST   /api/auth/signup
  POST   /api/auth/login
  POST   /api/auth/refresh
  POST   /api/auth/oauth/{provider}        (google, slack, apple)
  POST   /api/auth/sso/saml
  DELETE /api/auth/logout

VIDEOS
  POST   /api/videos                        (create video record, get upload URL)
  PUT    /api/videos/{id}/chunks/{index}    (upload HLS/recording chunk)
  POST   /api/videos/{id}/complete          (signal recording done)
  GET    /api/videos/{id}                   (video metadata + URLs)
  PATCH  /api/videos/{id}                   (update title, description, settings)
  DELETE /api/videos/{id}
  GET    /api/videos/{id}/status            (processing status WebSocket)
  POST   /api/videos/{id}/trim             (edit: trim)
  POST   /api/videos/{id}/stitch           (edit: insert clip)
  POST   /api/videos/{id}/transcript-edit  (edit: delete by transcript selection)
  GET    /api/videos/{id}/download         (signed MP4 download URL)
  POST   /api/videos/{id}/duplicate

TRANSCRIPTS
  GET    /api/videos/{id}/transcript
  GET    /api/videos/{id}/transcript/vtt
  GET    /api/videos/{id}/chapters

AI
  POST   /api/videos/{id}/ai/regenerate-title
  POST   /api/videos/{id}/ai/regenerate-summary
  POST   /api/videos/{id}/ai/workflow       { format: "bug_report" | "meeting_notes" | ... }
  POST   /api/videos/{id}/ai/tts            { text: "replacement text", start_ms, end_ms }

SHARING
  GET    /api/share/{shareId}               (public share page data)
  POST   /api/videos/{id}/share-settings    (update privacy, password, expiry)
  GET    /api/oembed?url=...

COLLABORATION
  GET    /api/videos/{id}/comments
  POST   /api/videos/{id}/comments          { body, timestamp_ms, parent_id? }
  POST   /api/videos/{id}/reactions         { emoji, timestamp_ms }
  POST   /api/videos/{id}/tasks             { title, assignee_id }

ANALYTICS
  POST   /api/videos/{id}/view              (register view)
  POST   /api/videos/{id}/events            (batch view events via sendBeacon)
  GET    /api/videos/{id}/analytics         (engagement data, heatmap)
  GET    /api/videos/{id}/viewers           (who watched)

LIBRARY
  GET    /api/workspaces/{id}/videos        (paginated, searchable)
  GET    /api/workspaces/{id}/folders
  POST   /api/workspaces/{id}/folders
  GET    /api/search?q=...                  (full-text across transcripts)

WORKSPACE
  GET    /api/workspaces/{id}
  PATCH  /api/workspaces/{id}               (branding, settings)
  GET    /api/workspaces/{id}/members
  POST   /api/workspaces/{id}/members/invite
  PATCH  /api/workspaces/{id}/members/{userId}  (role change)

SCREENSHOTS
  POST   /api/screenshots
  GET    /api/screenshots/{id}
  PATCH  /api/screenshots/{id}

INTEGRATIONS
  POST   /api/integrations/slack/install
  POST   /api/integrations/jira/install
  POST   /api/webhooks
  GET    /api/webhooks

NOTIFICATIONS
  GET    /api/notifications
  PATCH  /api/notifications/{id}/read
```

---

## 18. INFRASTRUCTURE & DEPLOYMENT

```yaml
# Kubernetes namespace layout
namespaces:
  - dittoo-api          # Core API pods (Node.js)
  - dittoo-workers      # Transcode + AI workers (Go + Python)
  - dittoo-realtime     # WebSocket pods
  - dittoo-data         # Redis, Elasticsearch
  - dittoo-monitoring   # Datadog agent, Sentry relay

# Terraform modules
modules:
  - vpc                 # VPC, subnets, security groups
  - eks                 # EKS cluster, node groups
  - rds                 # PostgreSQL (Multi-AZ)
  - elasticache         # Redis cluster
  - s3                  # Video storage buckets
  - cloudfront-or-fastly # CDN distribution
  - sqs                 # Job queues
  - gpu-nodes           # g5.xlarge for transcoding
  - route53             # DNS
  - acm                 # SSL certificates
  - iam                 # Service roles
```

---

## 19. PERFORMANCE ENGINEERING

| Metric | Target | How |
|---|---|---|
| Recording start | < 1 second | Pre-warm capture APIs on click |
| Share link available | Instant (before processing) | Link generated on recording start |
| Page load (share page) | < 1.5s | Vercel edge SSR + ISR |
| Video playback start | < 2s | Preload first 2 HLS segments, CDN edge cache |
| Transcript search | < 200ms | Elasticsearch with n-gram tokenizer |
| API response (p99) | < 200ms | Redis cache, connection pooling |
| Encoding start | < 5s after upload | Pre-warmed worker pool, no cold starts |
| Upload speed | Near line-speed | Chunked upload during recording, tus.io resumable |

---

## 20. SCALABILITY PLAYBOOK

| Component | Horizontal Scale Strategy |
|---|---|
| API Pods | HPA on CPU/request count, 3-50 pods |
| WebSocket Pods | Sticky sessions via Redis adapter, HPA on connections |
| Transcode Workers | Queue-based autoscaling (KEDA), scale to 0 at idle |
| AI Workers | GPU node autoscaling, spot instances for cost |
| PostgreSQL | RDS Multi-AZ + read replicas |
| Redis | ElastiCache cluster mode, 3+ shards |
| S3 | Infinite scale (managed) |
| CDN | Fastly global POPs (managed) |
| Elasticsearch | 3-node cluster, auto-expand |

---

## 21. COST MODEL (10K USERS)

| Resource | Monthly Cost |
|---|---|
| EKS (API + Workers) | ~$2,500 |
| RDS PostgreSQL (db.r6g.xlarge, Multi-AZ) | ~$800 |
| ElastiCache Redis (cache.r6g.large) | ~$400 |
| S3 Storage (50TB video) | ~$1,150 |
| Fastly CDN (100TB egress) | ~$4,000 |
| GPU Instances (g5.xlarge, spot) | ~$1,200 |
| Whisper Transcription (GPU time) | ~$500 |
| OpenAI API (titles/summaries/chapters) | ~$400 |
| Vercel (Pro plan, share pages) | ~$200 |
| Sentry + Datadog | ~$600 |
| Amplitude + Segment | ~$500 |
| Snowflake | ~$500 |
| SQS / Misc AWS | ~$200 |
| **Total** | **~$13,050/mo** |

---

## 22. TEAM & TIMELINE

### Team (5-7 Engineers)

| Role | Focus |
|---|---|
| 2x Full-Stack (React/Node/TS) | Dashboard, sharing, collaboration, integrations |
| 1x Media Engineer | Recording engine, FFmpeg, encoding pipeline, player |
| 1x Backend/Infra (Go/K8s) | Video processing workers, transcoding, infrastructure |
| 1x ML/AI Engineer (Python) | Transcription, AI features, eval framework |
| 1x Desktop/Extension (TS/Electron) | Chrome extension, Desktop app, native capture |
| 1x Design/Frontend | UI/UX matching Loom's design language |

### Timeline

| Phase | Weeks | Deliverable |
|---|---|---|
| 1. Recording Engine (Ext + Desktop) | 1-4 | Screen+cam capture, chunked upload, instant link |
| 2. Video Processing Pipeline | 3-6 | Transcode, HLS/DASH, thumbnails, GIF |
| 3. Player + Share Pages | 5-8 | Custom player, ABR streaming, share page SSR |
| 4. Transcription + AI | 6-9 | Whisper, auto-title/summary/chapters, VTT |
| 5. Collaboration | 8-11 | Comments, reactions, tasks, transcript editing |
| 6. Dashboard + Library | 9-12 | Video library, search, folders, workspaces |
| 7. Analytics | 11-14 | View tracking, heatmaps, viewer insights |
| 8. Video Editor | 12-15 | Trim, stitch, overlays, filler removal, blur |
| 9. Integrations | 14-17 | Slack, Gmail, Jira, Notion, webhooks |
| 10. Screenshots | 16-17 | Capture, annotate, share |
| 11. Meeting Recorder | 17-20 | Calendar sync, bot recording, recaps |
| 12. Enterprise Features | 18-22 | SSO/SCIM, data retention, branding, admin |

**Total: ~22 weeks (5.5 months) to full feature parity with Loom.**

---

## WHAT MAKES IT FEEL EXACTLY LIKE LOOM

1. **Share link ready the instant you stop recording** — not after processing
2. **3-2-1 countdown** with satisfying animation before recording starts
3. **Animated GIF thumbnails** on hover in library and Slack/email embeds
4. **Confetti animation** after your first recording
5. **Auto-copy link to clipboard** on stop
6. **Toast notification**: "Sarah just watched your video"
7. **Keyboard shortcuts** for everything (Ctrl+Shift+L to start recording)
8. **Drawing tools while recording** — pen, highlighter, arrow
9. **Camera bubble** draggable to any corner, resizable, with virtual backgrounds
10. **Filler word removal** that actually works (transcript-aligned trimming)
11. **Edit by transcript** — highlight text, press delete, video updates
12. **Auto-quality switching** — viewer never buffers, player adapts seamlessly
13. **< 2 second playback start** — preloaded segments from edge CDN
14. **Speaker notes** visible only to recorder, not in capture
15. **Click highlighting** with ripple animation