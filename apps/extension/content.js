/**
 * DITTOO Extension — Content Script
 *
 * Injects a floating recording widget into the current page.
 * Uses Shadow DOM to avoid style conflicts with the host page.
 *
 * Responsibilities:
 *   - Show recording controls (REC indicator, timer, pause/stop)
 *   - Show draggable camera bubble (circular webcam preview)
 *   - Manage MediaRecorder for the actual recording
 *   - Communicate with background.js via chrome.runtime messages
 */

(() => {
  // Prevent double-injection
  if (window.__dittooInjected) return;
  window.__dittooInjected = true;

  // ── State ───────────────────────────────────────────────

  let widgetHost = null;
  let shadowRoot = null;
  let timerInterval = null;
  let startTime = 0;
  let pausedDuration = 0;
  let pauseStart = 0;
  let mediaRecorder = null;
  let recordedChunks = [];
  let screenStream = null;
  let cameraStream = null;
  let combinedStream = null;
  let isPaused = false;
  let cameraBubbleEl = null;

  // ── Message Handler ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'startRecording':
        startRecording(message.options)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'stopRecording':
        stopRecording()
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'pauseRecording':
        pauseRecording();
        sendResponse({ success: true });
        return false;

      case 'resumeRecording':
        resumeRecording();
        sendResponse({ success: true });
        return false;

      case 'toggleWidget':
        toggleWidget();
        sendResponse({ success: true });
        return false;

      default:
        return false;
    }
  });

  // ── Start Recording ─────────────────────────────────────

  async function startRecording(options) {
    const { mode, streamId, captureType, cameraDeviceId, micDeviceId, quality } = options;

    const videoConstraints = quality === '1080'
      ? { width: 1920, height: 1080, frameRate: 30 }
      : { width: 1280, height: 720, frameRate: 30 };

    try {
      // Get screen stream
      if (captureType === 'desktop' && streamId) {
        screenStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: streamId,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: streamId,
              maxWidth: videoConstraints.width,
              maxHeight: videoConstraints.height,
              maxFrameRate: videoConstraints.frameRate,
            },
          },
        });
      }

      // Get camera stream (for screen+cam or camera-only modes)
      if (mode === 'screen-cam' || mode === 'camera') {
        const camConstraints = {
          video: cameraDeviceId
            ? { deviceId: { exact: cameraDeviceId }, ...videoConstraints }
            : videoConstraints,
          audio: micDeviceId
            ? { deviceId: { exact: micDeviceId } }
            : true,
        };

        cameraStream = await navigator.mediaDevices.getUserMedia(camConstraints);
      } else if (micDeviceId) {
        // Screen-only with mic
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
        });
        // Merge mic audio into screen stream
        if (screenStream) {
          micStream.getAudioTracks().forEach((track) => screenStream.addTrack(track));
        }
      }

      // Determine which stream to record
      if (mode === 'camera') {
        combinedStream = cameraStream;
      } else if (mode === 'screen-cam' && screenStream && cameraStream) {
        // Record screen stream; camera bubble is just a preview overlay
        // Merge camera audio into screen stream if screen has no audio
        const screenAudioTracks = screenStream.getAudioTracks();
        const camAudioTracks = cameraStream.getAudioTracks();

        if (screenAudioTracks.length === 0 && camAudioTracks.length > 0) {
          camAudioTracks.forEach((track) => screenStream.addTrack(track));
        }
        combinedStream = screenStream;
      } else {
        combinedStream = screenStream || cameraStream;
      }

      if (!combinedStream) {
        throw new Error('No media stream available');
      }

      // Set up MediaRecorder
      const bitrate = quality === '1080' ? 12_000_000 : 6_000_000;
      const mimeType = getPreferredMimeType();

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        handleRecordingStopped();
      };

      mediaRecorder.start(1000); // Collect data every second

      // Inject the widget UI
      injectWidget(mode);
      startTimer();

    } catch (err) {
      cleanup();
      throw err;
    }
  }

  // ── Stop Recording ──────────────────────────────────────

  async function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    // The onstop handler will do the rest
  }

  function handleRecordingStopped() {
    stopTimer();

    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' });
    const duration = (Date.now() - startTime - pausedDuration) / 1000;

    // Send blob data to background for upload
    // Note: We can't send Blob directly via messaging, so we convert to array
    blob.arrayBuffer().then((buffer) => {
      chrome.runtime.sendMessage({
        type: 'recordingComplete',
        blob: Array.from(new Uint8Array(buffer)),
        duration,
      });
    }).catch((err) => {
      console.error('Failed to process recording:', err);
      // Fallback: trigger download
      downloadLocally(blob);
    });

    cleanup();
    removeWidget();
  }

  function downloadLocally(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dittoo-recording-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Pause / Resume ──────────────────────────────────────

  function pauseRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      isPaused = true;
      pauseStart = Date.now();
      updateWidgetPauseState(true);
    }
  }

  function resumeRecording() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      isPaused = false;
      pausedDuration += Date.now() - pauseStart;
      updateWidgetPauseState(false);
    }
  }

  // ── Timer ───────────────────────────────────────────────

  function startTimer() {
    startTime = Date.now();
    pausedDuration = 0;
    timerInterval = setInterval(updateTimer, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimer() {
    if (!shadowRoot) return;
    const timerEl = shadowRoot.querySelector('.dittoo-timer');
    if (!timerEl) return;

    let elapsed = Date.now() - startTime - pausedDuration;
    if (isPaused) {
      elapsed -= (Date.now() - pauseStart);
    }

    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  // ── Widget Injection (Shadow DOM) ───────────────────────

  function injectWidget(mode) {
    if (widgetHost) removeWidget();

    widgetHost = document.createElement('div');
    widgetHost.id = 'dittoo-recording-widget';
    widgetHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none;';
    document.documentElement.appendChild(widgetHost);

    shadowRoot = widgetHost.attachShadow({ mode: 'closed' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = getWidgetStyles();
    shadowRoot.appendChild(style);

    // Control bar
    const bar = document.createElement('div');
    bar.className = 'dittoo-bar';
    bar.innerHTML = `
      <div class="dittoo-rec-indicator">
        <span class="dittoo-rec-dot"></span>
        <span class="dittoo-rec-label">REC</span>
      </div>
      <span class="dittoo-timer">00:00</span>
      <div class="dittoo-divider"></div>
      <button class="dittoo-btn dittoo-pause-btn" title="Pause">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="3" y="2" width="3" height="10" rx="0.5"/>
          <rect x="8" y="2" width="3" height="10" rx="0.5"/>
        </svg>
      </button>
      <button class="dittoo-btn dittoo-stop-btn" title="Stop Recording">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="2" y="2" width="10" height="10" rx="1.5"/>
        </svg>
      </button>
    `;
    shadowRoot.appendChild(bar);

    // Bind bar events
    const pauseBtn = bar.querySelector('.dittoo-pause-btn');
    const stopBtn = bar.querySelector('.dittoo-stop-btn');

    pauseBtn.addEventListener('click', () => {
      if (isPaused) {
        chrome.runtime.sendMessage({ type: 'resumeRecording' });
        resumeRecording();
      } else {
        chrome.runtime.sendMessage({ type: 'pauseRecording' });
        pauseRecording();
      }
    });

    stopBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'stopRecording' });
    });

    // Camera bubble (for screen+cam mode)
    if ((mode === 'screen-cam' || mode === 'camera') && cameraStream) {
      const bubble = document.createElement('div');
      bubble.className = 'dittoo-camera-bubble';

      const video = document.createElement('video');
      video.srcObject = cameraStream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      bubble.appendChild(video);

      shadowRoot.appendChild(bubble);
      cameraBubbleEl = bubble;

      // Make the bubble draggable
      makeDraggable(bubble);
    }
  }

  function removeWidget() {
    if (widgetHost && widgetHost.parentNode) {
      widgetHost.parentNode.removeChild(widgetHost);
    }
    widgetHost = null;
    shadowRoot = null;
    cameraBubbleEl = null;
  }

  function toggleWidget() {
    if (!widgetHost) return;
    const isHidden = widgetHost.style.display === 'none';
    widgetHost.style.display = isHidden ? '' : 'none';
  }

  function updateWidgetPauseState(paused) {
    if (!shadowRoot) return;

    const pauseBtn = shadowRoot.querySelector('.dittoo-pause-btn');
    const recDot = shadowRoot.querySelector('.dittoo-rec-dot');
    const recLabel = shadowRoot.querySelector('.dittoo-rec-label');

    if (paused) {
      pauseBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <polygon points="4,2 12,7 4,12"/>
        </svg>
      `;
      pauseBtn.title = 'Resume';
      recDot.classList.add('paused');
      recLabel.textContent = 'PAUSED';
    } else {
      pauseBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="3" y="2" width="3" height="10" rx="0.5"/>
          <rect x="8" y="2" width="3" height="10" rx="0.5"/>
        </svg>
      `;
      pauseBtn.title = 'Pause';
      recDot.classList.remove('paused');
      recLabel.textContent = 'REC';
    }
  }

  // ── Draggable Camera Bubble ─────────────────────────────

  function makeDraggable(el) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    el.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;

      // Clamp to viewport
      const size = 128; // bubble size
      x = Math.max(8, Math.min(window.innerWidth - size - 8, x));
      y = Math.max(8, Math.min(window.innerHeight - size - 8, y));

      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        el.style.transition = 'transform 0.15s ease';
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────

  function getPreferredMimeType() {
    const types = [
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
  }

  function cleanup() {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    combinedStream = null;
    mediaRecorder = null;
    recordedChunks = [];
    isPaused = false;
  }

  function getWidgetStyles() {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .dittoo-bar {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background: rgba(10, 10, 10, 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 100px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: white;
        pointer-events: auto;
        user-select: none;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 2147483647;
      }

      .dittoo-rec-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .dittoo-rec-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff3333;
        animation: dittoo-pulse 1.2s ease-in-out infinite;
      }

      .dittoo-rec-dot.paused {
        animation: none;
        background: #ffaa00;
      }

      @keyframes dittoo-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }

      .dittoo-rec-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        color: #ff3333;
      }

      .dittoo-rec-dot.paused + .dittoo-rec-label {
        color: #ffaa00;
      }

      .dittoo-timer {
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        min-width: 48px;
        text-align: center;
      }

      .dittoo-divider {
        width: 1px;
        height: 20px;
        background: rgba(255, 255, 255, 0.15);
      }

      .dittoo-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        color: white;
        cursor: pointer;
        transition: background 0.15s ease;
        pointer-events: auto;
      }

      .dittoo-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .dittoo-stop-btn {
        background: rgba(255, 51, 51, 0.3);
        color: #ff5555;
      }

      .dittoo-stop-btn:hover {
        background: rgba(255, 51, 51, 0.5);
      }

      /* Camera Bubble */
      .dittoo-camera-bubble {
        position: fixed;
        bottom: 80px;
        right: 24px;
        width: 128px;
        height: 128px;
        border-radius: 50%;
        overflow: hidden;
        border: 3px solid rgba(255, 255, 255, 0.9);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
        cursor: grab;
        pointer-events: auto;
        z-index: 2147483646;
        transition: transform 0.15s ease;
      }

      .dittoo-camera-bubble:hover {
        transform: scale(1.05);
      }

      .dittoo-camera-bubble:active {
        cursor: grabbing;
        transform: scale(0.98);
      }

      .dittoo-camera-bubble video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
        pointer-events: none;
      }
    `;
  }
})();
