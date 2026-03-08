# DITTOO Chrome Extension — Screen Recorder

Record your screen, camera, and mic. Share instantly.

## Setup (Development)

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select this `apps/extension/` folder
4. Click the DITTOO icon in your toolbar

## Generate Icons

Before loading the extension, you need PNG icons:

1. Open `icons/generate-icons.html` in your browser
2. Click **Download All** to save `icon16.png`, `icon48.png`, `icon128.png`
3. Move the downloaded PNGs into the `icons/` folder

## Architecture

```
popup.html / popup.js    — Extension popup (device selection, start recording)
background.js            — Service worker (recording lifecycle, upload orchestration)
content.js / content.css — Injected recording widget (timer, pause/stop, camera bubble)
recorder.js              — Shared recording logic (MediaRecorder, audio mixing, compositor)
uploader.js              — Upload manager (auth, presigned URLs, retry logic)
```

## Recording Flow

1. User clicks **Start Recording** in popup
2. `popup.js` sends `startRecording` message to `background.js`
3. `background.js` triggers `chrome.desktopCapture.chooseDesktopMedia()`
4. Once user picks a source, background forwards the stream ID to `content.js`
5. `content.js` injects the floating recording widget + camera bubble
6. `content.js` runs MediaRecorder against the captured streams
7. On stop, the recorded blob is sent to `background.js` for upload
8. `background.js` uploads via `uploader.js` and opens the share page

## Permissions

- `activeTab` — Access the current tab for content script injection
- `desktopCapture` — Screen/window/tab capture
- `tabCapture` — Tab audio capture
- `storage` — Save preferences and auth token
