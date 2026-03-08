/**
 * DITTOO Extension — Background Service Worker
 *
 * Manages recording lifecycle:
 *   1. Receives startRecording from popup
 *   2. Uses desktopCapture / tabCapture to get streams
 *   3. Delegates to offscreen document or content script for MediaRecorder
 *   4. Handles stopRecording and triggers upload
 *   5. Opens share page on completion
 */

// ── State ─────────────────────────────────────────────────

let recordingState = {
  isRecording: false,
  isPaused: false,
  tabId: null,
  streamId: null,
  startTime: null,
  options: null,
};

// ── Message Router ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'startRecording':
      handleStartRecording(message.options, sender)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response

    case 'stopRecording':
      handleStopRecording()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'pauseRecording':
      handlePauseRecording()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'resumeRecording':
      handleResumeRecording()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'getState':
      sendResponse({
        isRecording: recordingState.isRecording,
        isPaused: recordingState.isPaused,
        startTime: recordingState.startTime,
        mode: recordingState.options?.mode,
      });
      return false;

    case 'recordingComplete':
      handleRecordingComplete(message.blob, message.duration)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

// ── Start Recording ───────────────────────────────────────

async function handleStartRecording(options, sender) {
  if (recordingState.isRecording) {
    return { success: false, error: 'Already recording' };
  }

  // Get the current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { success: false, error: 'No active tab found' };
  }

  recordingState.tabId = tab.id;
  recordingState.options = options;

  try {
    if (options.mode === 'camera') {
      // Camera-only mode: just forward to content script
      await sendToContentScript(tab.id, {
        type: 'startRecording',
        options: {
          ...options,
          streamId: null,
          captureType: 'camera',
        },
      });
    } else {
      // Screen or Screen+Cam: use desktopCapture
      const streamId = await requestDesktopCapture(tab);
      recordingState.streamId = streamId;

      await sendToContentScript(tab.id, {
        type: 'startRecording',
        options: {
          ...options,
          streamId,
          captureType: 'desktop',
        },
      });
    }

    recordingState.isRecording = true;
    recordingState.startTime = Date.now();

    // Update badge to show recording indicator
    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ff3333' });

    return { success: true };
  } catch (err) {
    resetState();
    return { success: false, error: err.message };
  }
}

// ── Desktop Capture ───────────────────────────────────────

function requestDesktopCapture(tab) {
  return new Promise((resolve, reject) => {
    const sources = ['screen', 'window', 'tab'];

    chrome.desktopCapture.chooseDesktopMedia(sources, tab, (streamId) => {
      if (!streamId) {
        reject(new Error('Screen capture was cancelled'));
        return;
      }
      resolve(streamId);
    });
  });
}

// ── Stop Recording ────────────────────────────────────────

async function handleStopRecording() {
  if (!recordingState.isRecording) {
    return { success: false, error: 'Not recording' };
  }

  try {
    if (recordingState.tabId) {
      await sendToContentScript(recordingState.tabId, { type: 'stopRecording' });
    }

    // Badge cleared when recording data comes back via recordingComplete
    return { success: true };
  } catch (err) {
    resetState();
    return { success: false, error: err.message };
  }
}

// ── Pause / Resume ────────────────────────────────────────

async function handlePauseRecording() {
  if (!recordingState.isRecording || recordingState.isPaused) {
    return { success: false, error: 'Cannot pause' };
  }

  try {
    await sendToContentScript(recordingState.tabId, { type: 'pauseRecording' });
    recordingState.isPaused = true;
    await chrome.action.setBadgeText({ text: '||' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleResumeRecording() {
  if (!recordingState.isRecording || !recordingState.isPaused) {
    return { success: false, error: 'Cannot resume' };
  }

  try {
    await sendToContentScript(recordingState.tabId, { type: 'resumeRecording' });
    recordingState.isPaused = false;
    await chrome.action.setBadgeText({ text: 'REC' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Recording Complete ────────────────────────────────────

async function handleRecordingComplete(blobData, duration) {
  try {
    // Clear badge
    await chrome.action.setBadgeText({ text: '' });

    // Attempt upload
    const shareUrl = await uploadRecording(blobData, duration);

    if (shareUrl) {
      // Open share page in new tab
      await chrome.tabs.create({ url: shareUrl });
    } else {
      // Fallback: offer download
      // The content script handles local save as fallback
      console.log('Upload failed, recording saved locally');
    }
  } catch (err) {
    console.error('Recording complete handler failed:', err);
  } finally {
    resetState();
  }

  return { success: true };
}

// ── Upload ────────────────────────────────────────────────

async function uploadRecording(blobData, duration) {
  try {
    // Get auth token
    const result = await chrome.storage.local.get('dittoo_auth_token');
    const token = result.dittoo_auth_token;
    if (!token) {
      console.warn('No auth token — skipping upload');
      return null;
    }

    const apiBase = await getApiBase();

    // Step 1: Create video record
    const createRes = await fetch(`${apiBase}/api/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: `Recording ${new Date().toLocaleString()}`,
        duration,
        source: 'extension',
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Create video failed: ${createRes.status}`);
    }

    const { videoId, uploadUrl } = await createRes.json();

    // Step 2: Upload blob to presigned URL
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm' },
      body: blobData,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.status}`);
    }

    // Step 3: Mark upload complete
    const completeRes = await fetch(`${apiBase}/api/videos/${videoId}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!completeRes.ok) {
      throw new Error(`Complete failed: ${completeRes.status}`);
    }

    return `${getShareBase()}/v/${videoId}`;
  } catch (err) {
    console.error('Upload failed:', err);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Content script might not be injected yet — inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    });
    // Retry
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function getApiBase() {
  const result = await chrome.storage.local.get('dittoo_api_base');
  return result.dittoo_api_base || 'https://api.dittoo.com';
}

function getShareBase() {
  // In dev, this would be localhost:5173
  return 'https://dittoo.com';
}

function resetState() {
  recordingState = {
    isRecording: false,
    isPaused: false,
    tabId: null,
    streamId: null,
    startTime: null,
    options: null,
  };
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

// ── Extension Icon Click (when no popup, e.g. while recording) ──

chrome.action.onClicked.addListener(async (tab) => {
  if (recordingState.isRecording) {
    // Toggle recording widget visibility via content script
    await sendToContentScript(tab.id, { type: 'toggleWidget' });
  }
});

// ── Handle tab close while recording ──────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingState.tabId && recordingState.isRecording) {
    console.warn('Recording tab was closed — stopping recording');
    handleStopRecording().catch(console.error);
  }
});
