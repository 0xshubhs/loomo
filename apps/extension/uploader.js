/**
 * DITTOO Extension — Upload Manager
 *
 * Handles the upload flow after recording:
 *   1. Get auth token from chrome.storage
 *   2. Create video record via DITTOO API
 *   3. Upload blob to presigned URL
 *   4. Call complete endpoint
 *   5. Return share URL
 *
 * Also handles retry logic and progress reporting.
 */

const DittooUploader = (() => {
  const DEFAULT_API_BASE = 'https://api.dittoo.com';
  const DEFAULT_SHARE_BASE = 'https://dittoo.com';
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  // ── Config ──────────────────────────────────────────────

  async function getConfig() {
    try {
      const result = await chrome.storage.local.get([
        'dittoo_api_base',
        'dittoo_share_base',
        'dittoo_auth_token',
      ]);
      return {
        apiBase: result.dittoo_api_base || DEFAULT_API_BASE,
        shareBase: result.dittoo_share_base || DEFAULT_SHARE_BASE,
        authToken: result.dittoo_auth_token || null,
      };
    } catch {
      return {
        apiBase: DEFAULT_API_BASE,
        shareBase: DEFAULT_SHARE_BASE,
        authToken: null,
      };
    }
  }

  // ── Main Upload Flow ────────────────────────────────────

  async function upload(blob, metadata = {}, onProgress = null) {
    const config = await getConfig();

    if (!config.authToken) {
      return {
        success: false,
        error: 'Not authenticated. Please login to DITTOO.',
        requiresAuth: true,
      };
    }

    try {
      // Step 1: Create video record
      if (onProgress) onProgress({ stage: 'creating', progress: 0 });

      const videoRecord = await createVideoRecord(config, metadata);

      // Step 2: Upload blob to presigned URL
      if (onProgress) onProgress({ stage: 'uploading', progress: 0 });

      await uploadBlob(videoRecord.uploadUrl, blob, (progress) => {
        if (onProgress) onProgress({ stage: 'uploading', progress });
      });

      // Step 3: Mark upload complete
      if (onProgress) onProgress({ stage: 'processing', progress: 100 });

      await completeUpload(config, videoRecord.videoId);

      const shareUrl = `${config.shareBase}/v/${videoRecord.videoId}`;

      if (onProgress) onProgress({ stage: 'complete', progress: 100, shareUrl });

      return {
        success: true,
        videoId: videoRecord.videoId,
        shareUrl,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  // ── API: Create Video Record ────────────────────────────

  async function createVideoRecord(config, metadata) {
    const body = {
      title: metadata.title || `Recording ${new Date().toLocaleString()}`,
      duration: metadata.duration || 0,
      source: 'extension',
      mode: metadata.mode || 'screen',
      quality: metadata.quality || '1080p',
    };

    const response = await fetchWithRetry(`${config.apiBase}/api/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired — clear it
        await chrome.storage.local.remove('dittoo_auth_token');
        throw new Error('Session expired. Please login again.');
      }
      throw new Error(`Failed to create video: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      videoId: data.videoId || data.id,
      uploadUrl: data.uploadUrl || data.upload_url,
    };
  }

  // ── API: Upload Blob ────────────────────────────────────

  async function uploadBlob(uploadUrl, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', 'video/webm');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed: network error'));
      xhr.ontimeout = () => reject(new Error('Upload failed: timeout'));

      // 10 minute timeout for large files
      xhr.timeout = 600_000;

      xhr.send(blob);
    });
  }

  // ── API: Complete Upload ────────────────────────────────

  async function completeUpload(config, videoId) {
    const response = await fetchWithRetry(`${config.apiBase}/api/videos/${videoId}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to complete upload: ${response.status}`);
    }

    return response.json();
  }

  // ── Auth Helpers ────────────────────────────────────────

  async function setAuthToken(token) {
    await chrome.storage.local.set({ dittoo_auth_token: token });
  }

  async function clearAuthToken() {
    await chrome.storage.local.remove('dittoo_auth_token');
  }

  async function isAuthenticated() {
    const config = await getConfig();
    return !!config.authToken;
  }

  // ── Retry Logic ─────────────────────────────────────────

  async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Don't retry client errors (4xx), only server errors (5xx)
        if (response.status >= 500 && attempt < retries) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        return response;
      } catch (err) {
        if (attempt === retries) throw err;
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Public API ──────────────────────────────────────────

  return {
    upload,
    setAuthToken,
    clearAuthToken,
    isAuthenticated,
    getConfig,
  };
})();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DittooUploader;
}
