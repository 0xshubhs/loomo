/**
 * DITTOO Extension — Shared Recorder Logic
 *
 * Provides reusable recording utilities:
 *   - MediaRecorder setup with H.264/VP9 codec preference
 *   - Canvas compositor for screen + camera overlay
 *   - Audio mixing via Web Audio API
 *   - Quality presets matching the web app
 *
 * This module is imported by content.js for the actual recording pipeline.
 * It can also be used standalone for testing.
 */

const DittooRecorder = (() => {
  // ── Quality Presets ───────────────────────────────────────

  const QUALITY_PRESETS = {
    '1080': {
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoBitsPerSecond: 12_000_000, // 12 Mbps
      audioBitsPerSecond: 128_000,
    },
    '720': {
      width: 1280,
      height: 720,
      frameRate: 30,
      videoBitsPerSecond: 6_000_000, // 6 Mbps
      audioBitsPerSecond: 128_000,
    },
  };

  // ── MIME Type Detection ─────────────────────────────────

  const PREFERRED_MIME_TYPES = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  function getBestMimeType() {
    for (const type of PREFERRED_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  }

  // ── MediaRecorder Factory ───────────────────────────────

  function createRecorder(stream, quality = '1080') {
    const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS['1080'];
    const mimeType = getBestMimeType();

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: preset.videoBitsPerSecond,
      audioBitsPerSecond: preset.audioBitsPerSecond,
    });

    return {
      recorder,
      mimeType,
      preset,
    };
  }

  // ── Audio Mixer ─────────────────────────────────────────
  // Merges multiple audio sources into a single MediaStream track

  function createAudioMixer(audioTracks) {
    if (audioTracks.length === 0) return null;
    if (audioTracks.length === 1) {
      return new MediaStream([audioTracks[0]]);
    }

    const ctx = new AudioContext();
    const destination = ctx.createMediaStreamDestination();

    audioTracks.forEach((track) => {
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      source.connect(gain);
      gain.connect(destination);
    });

    return {
      stream: destination.stream,
      context: ctx,
      cleanup() {
        ctx.close().catch(() => {});
      },
    };
  }

  // ── Canvas Compositor ───────────────────────────────────
  // Composites screen capture + camera into a single video stream

  function createCompositor(screenStream, cameraStream, quality = '1080') {
    const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS['1080'];
    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;

    const ctx = canvas.getContext('2d');
    const screenVideo = document.createElement('video');
    const cameraVideo = document.createElement('video');

    screenVideo.srcObject = screenStream;
    screenVideo.muted = true;
    screenVideo.play();

    cameraVideo.srcObject = cameraStream;
    cameraVideo.muted = true;
    cameraVideo.play();

    // Camera bubble dimensions (bottom-right corner)
    const bubbleSize = Math.round(preset.width * 0.15); // 15% of width
    const bubbleMargin = 24;
    const bubbleX = preset.width - bubbleSize - bubbleMargin;
    const bubbleY = preset.height - bubbleSize - bubbleMargin;

    let animationFrame = null;
    let isRunning = false;

    function drawFrame() {
      if (!isRunning) return;

      // Draw screen capture
      ctx.drawImage(screenVideo, 0, 0, preset.width, preset.height);

      // Draw camera bubble (circular)
      ctx.save();
      ctx.beginPath();
      const centerX = bubbleX + bubbleSize / 2;
      const centerY = bubbleY + bubbleSize / 2;
      const radius = bubbleSize / 2;
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Mirror the camera horizontally
      ctx.translate(bubbleX + bubbleSize, bubbleY);
      ctx.scale(-1, 1);
      ctx.drawImage(cameraVideo, 0, 0, bubbleSize, bubbleSize);
      ctx.restore();

      // Draw bubble border
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();

      animationFrame = requestAnimationFrame(drawFrame);
    }

    function start() {
      isRunning = true;
      drawFrame();
      return canvas.captureStream(preset.frameRate);
    }

    function stop() {
      isRunning = false;
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
    }

    return { start, stop, canvas };
  }

  // ── Stream Combiner ─────────────────────────────────────
  // Combines video and audio tracks from multiple sources

  function combineStreams({ screenStream, cameraStream, mode, quality }) {
    let videoStream;
    let audioMixer = null;

    if (mode === 'screen-cam' && screenStream && cameraStream) {
      // Use canvas compositor for embedded camera
      const compositor = createCompositor(screenStream, cameraStream, quality);
      videoStream = compositor.start();

      // Mix audio from both sources
      const allAudioTracks = [
        ...screenStream.getAudioTracks(),
        ...cameraStream.getAudioTracks(),
      ];

      if (allAudioTracks.length > 0) {
        audioMixer = createAudioMixer(allAudioTracks);
        if (audioMixer && audioMixer.stream) {
          audioMixer.stream.getAudioTracks().forEach((track) => {
            videoStream.addTrack(track);
          });
        }
      }

      return {
        stream: videoStream,
        cleanup() {
          compositor.stop();
          if (audioMixer) audioMixer.cleanup();
        },
      };
    }

    if (mode === 'camera') {
      return {
        stream: cameraStream,
        cleanup() {},
      };
    }

    // Screen only
    return {
      stream: screenStream,
      cleanup() {},
    };
  }

  // ── Public API ──────────────────────────────────────────

  return {
    QUALITY_PRESETS,
    getBestMimeType,
    createRecorder,
    createAudioMixer,
    createCompositor,
    combineStreams,
  };
})();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DittooRecorder;
}
