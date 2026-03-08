/**
 * DITTOO Extension — Popup Script
 *
 * Handles device enumeration, preference storage, and recording triggers.
 * Vanilla JS — no framework, no build step.
 */

const STORAGE_KEYS = {
  MODE: 'dittoo_mode',
  CAMERA: 'dittoo_camera',
  MIC: 'dittoo_mic',
  QUALITY: 'dittoo_quality',
  AUTH_TOKEN: 'dittoo_auth_token',
};

const DEFAULT_PREFS = {
  mode: 'screen-cam',
  quality: '1080',
};

// ── DOM refs ──────────────────────────────────────────────

const modeButtons = document.querySelectorAll('.mode-btn');
const qualityButtons = document.querySelectorAll('.quality-btn');
const cameraSelect = document.getElementById('cameraSelect');
const micSelect = document.getElementById('micSelect');
const recordBtn = document.getElementById('recordBtn');
const statusEl = document.getElementById('status');
const loginSection = document.getElementById('loginSection');
const loginLink = document.getElementById('loginLink');

let currentPrefs = { ...DEFAULT_PREFS };
let isRecording = false;

// ── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadPreferences();
  await enumerateDevices();
  await checkRecordingState();
  await checkAuthState();
  applyPrefsToUI();
  bindEvents();
});

// ── Preferences ───────────────────────────────────────────

async function loadPreferences() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.MODE,
      STORAGE_KEYS.CAMERA,
      STORAGE_KEYS.MIC,
      STORAGE_KEYS.QUALITY,
    ]);
    currentPrefs = {
      mode: result[STORAGE_KEYS.MODE] || DEFAULT_PREFS.mode,
      camera: result[STORAGE_KEYS.CAMERA] || '',
      mic: result[STORAGE_KEYS.MIC] || '',
      quality: result[STORAGE_KEYS.QUALITY] || DEFAULT_PREFS.quality,
    };
  } catch (err) {
    console.warn('Failed to load preferences:', err);
  }
}

async function savePreferences() {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MODE]: currentPrefs.mode,
      [STORAGE_KEYS.CAMERA]: currentPrefs.camera,
      [STORAGE_KEYS.MIC]: currentPrefs.mic,
      [STORAGE_KEYS.QUALITY]: currentPrefs.quality,
    });
  } catch (err) {
    console.warn('Failed to save preferences:', err);
  }
}

function applyPrefsToUI() {
  // Mode buttons
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === currentPrefs.mode);
  });

  // Quality buttons
  qualityButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === currentPrefs.quality);
  });

  // Device selects (will be applied after enumeration)
  if (currentPrefs.camera && cameraSelect.querySelector(`option[value="${currentPrefs.camera}"]`)) {
    cameraSelect.value = currentPrefs.camera;
  }
  if (currentPrefs.mic && micSelect.querySelector(`option[value="${currentPrefs.mic}"]`)) {
    micSelect.value = currentPrefs.mic;
  }
}

// ── Device Enumeration ────────────────────────────────────

async function enumerateDevices() {
  try {
    // Request permission first so we get labels
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    // Stop tracks immediately — we just needed permission for labels
    stream.getTracks().forEach((t) => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();

    // Cameras
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    cameraSelect.innerHTML = '';
    if (cameras.length === 0) {
      cameraSelect.innerHTML = '<option value="">No camera found</option>';
    } else {
      cameras.forEach((cam, i) => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        opt.textContent = cam.label || `Camera ${i + 1}`;
        cameraSelect.appendChild(opt);
      });
    }

    // Microphones
    const mics = devices.filter((d) => d.kind === 'audioinput');
    micSelect.innerHTML = '';
    if (mics.length === 0) {
      micSelect.innerHTML = '<option value="">No microphone found</option>';
    } else {
      mics.forEach((mic, i) => {
        const opt = document.createElement('option');
        opt.value = mic.deviceId;
        opt.textContent = mic.label || `Microphone ${i + 1}`;
        micSelect.appendChild(opt);
      });
    }

    // Apply saved selections
    applyPrefsToUI();
  } catch (err) {
    console.warn('Device enumeration failed:', err);
    setStatus('Grant camera/mic permission to select devices', 'error');
  }
}

// ── Recording State ───────────────────────────────────────

async function checkRecordingState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getState' });
    if (response && response.isRecording) {
      isRecording = true;
      updateRecordButton(true);
    }
  } catch (err) {
    // Background not ready yet, that's fine
  }
}

async function checkAuthState() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
    const hasToken = !!result[STORAGE_KEYS.AUTH_TOKEN];
    loginSection.classList.toggle('visible', !hasToken);
  } catch (err) {
    loginSection.classList.add('visible');
  }
}

// ── Event Binding ─────────────────────────────────────────

function bindEvents() {
  // Mode selector
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPrefs.mode = btn.dataset.mode;
      savePreferences();
    });
  });

  // Quality selector
  qualityButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      qualityButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPrefs.quality = btn.dataset.quality;
      savePreferences();
    });
  });

  // Device selects
  cameraSelect.addEventListener('change', () => {
    currentPrefs.camera = cameraSelect.value;
    savePreferences();
  });

  micSelect.addEventListener('change', () => {
    currentPrefs.mic = micSelect.value;
    savePreferences();
  });

  // Record button
  recordBtn.addEventListener('click', handleRecordClick);

  // Login link
  loginLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://dittoo.com/login' });
    window.close();
  });
}

// ── Record Action ─────────────────────────────────────────

async function handleRecordClick() {
  if (isRecording) {
    // Stop recording
    try {
      setStatus('Stopping...', '');
      const response = await chrome.runtime.sendMessage({ type: 'stopRecording' });
      if (response && response.success) {
        isRecording = false;
        updateRecordButton(false);
        setStatus('Recording saved!', 'success');
      } else {
        setStatus(response?.error || 'Failed to stop recording', 'error');
      }
    } catch (err) {
      setStatus('Failed to stop recording', 'error');
    }
    return;
  }

  // Start recording
  try {
    setStatus('Starting...', '');
    const response = await chrome.runtime.sendMessage({
      type: 'startRecording',
      options: {
        mode: currentPrefs.mode,
        cameraDeviceId: cameraSelect.value,
        micDeviceId: micSelect.value,
        quality: currentPrefs.quality,
      },
    });

    if (response && response.success) {
      isRecording = true;
      updateRecordButton(true);
      setStatus('Recording in progress', '');
      // Close popup — the content script widget takes over
      setTimeout(() => window.close(), 500);
    } else {
      setStatus(response?.error || 'Failed to start recording', 'error');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }
}

// ── UI Helpers ────────────────────────────────────────────

function updateRecordButton(recording) {
  if (recording) {
    recordBtn.classList.add('recording');
    recordBtn.innerHTML = '<span class="record-dot"></span> Stop Recording';
  } else {
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = '<span class="record-dot"></span> Start Recording';
  }
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type) {
    statusEl.classList.add(type);
  }
}
