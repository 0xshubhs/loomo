import { MediaStreamManager } from './media-stream-manager.js';
import { CanvasCompositor } from './canvas-compositor.js';
import type { RecorderStore } from '$lib/state/recorder.svelte.js';
import type { RecordingResult } from '$lib/types/recorder.js';
import { QUALITY_MAP } from '$lib/types/recorder.js';

export class RecordingSession {
  private streamManager = new MediaStreamManager();
  private compositor: CanvasCompositor | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private pausedDuration = 0;
  private pauseStart = 0;

  constructor(private store: RecorderStore) {}

  async start(): Promise<void> {
    const { mode, quality, selectedCameraId, selectedMicId, systemAudioEnabled } = this.store;
    const { width, height } = QUALITY_MAP[quality];

    this.store.startCountdown();
    await this.countdown();

    try {
      let outputStream: MediaStream;

      if (mode === 'camera-only') {
        const camStream = await this.streamManager.requestCamera(selectedCameraId);
        this.store.cameraStream = camStream;
        const micStream = await this.streamManager.requestMicrophone(selectedMicId);
        outputStream = this.mergeStreams([camStream], [micStream]);
      } else {
        // Screen capture — request high quality
        const screenStream = await this.streamManager.requestScreenCapture(systemAudioEnabled);

        // Listen for user stopping screen share
        screenStream.getVideoTracks()[0].onended = () => {
          if (this.store.isRecording || this.store.isPaused) {
            this.stop();
          }
        };

        // Microphone
        const micStream = await this.streamManager.requestMicrophone(selectedMicId);

        if (mode === 'screen-cam') {
          // Camera
          const camStream = await this.streamManager.requestCamera(selectedCameraId);
          this.store.cameraStream = camStream;

          // Canvas compositor for screen + camera overlay
          this.compositor = new CanvasCompositor(width, height);
          this.compositor.setScreenSource(screenStream);
          this.compositor.setCameraSource(camStream);
          const composited = this.compositor.start();

          // Merge composited video + audio
          const audioStreams = [micStream];
          if (screenStream.getAudioTracks().length > 0) {
            audioStreams.push(screenStream);
          }
          outputStream = this.mergeStreams([composited], audioStreams);
        } else {
          // Screen only — pass the original stream directly for maximum quality
          const audioStreams = [micStream];
          if (screenStream.getAudioTracks().length > 0) {
            audioStreams.push(screenStream);
          }
          outputStream = this.mergeStreams([screenStream], audioStreams);
        }
      }

      // Create MediaRecorder with best available codec
      const mimeType = this.getSupportedMimeType();
      const bitrate = this.getBitrate(quality, mode === 'screen-cam');
      this.mediaRecorder = new MediaRecorder(outputStream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });

      this.chunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      // Use larger timeslice for better quality (less overhead from frequent chunk boundaries)
      this.mediaRecorder.start(5000);
      this.store.startRecording();
      this.startTimer();
    } catch (err) {
      this.streamManager.stopAllStreams();
      this.store.setError(`Recording failed: ${err}`);
      throw err;
    }
  }

  pause() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
      this.store.pauseRecording();
      this.pauseStart = Date.now();
    }
  }

  resume() {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
      this.store.resumeRecording();
      this.pausedDuration += Date.now() - this.pauseStart;
    }
  }

  async stop(): Promise<RecordingResult> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        this.store.setError('No active recording');
        throw new Error('No active recording');
      }

      this.mediaRecorder.onstop = async () => {
        this.stopTimer();
        this.compositor?.stop();
        this.store.cleanupCameraStream();
        this.streamManager.stopAllStreams();

        const blob = new Blob(this.chunks, { type: this.mediaRecorder!.mimeType });
        const duration = this.store.elapsedSeconds;

        // Generate thumbnail
        const thumbnailUrl = await this.generateThumbnail(blob);

        const result: RecordingResult = {
          blob,
          duration,
          mimeType: this.mediaRecorder!.mimeType,
          thumbnailUrl,
        };

        this.store.setResult(result);
        resolve(result);
      };

      this.store.stopRecording();
      this.mediaRecorder.stop();
    });
  }

  cancel() {
    this.stopTimer();
    this.mediaRecorder?.stop();
    this.compositor?.stop();
    this.store.cleanupCameraStream();
    this.streamManager.stopAllStreams();
    this.store.reset();
  }

  updateCameraBubblePosition(x: number, y: number) {
    this.compositor?.setCameraBubblePosition(x, y);
  }

  private async countdown(): Promise<void> {
    return new Promise((resolve) => {
      let count = 3;
      this.store.countdownValue = count;
      const interval = setInterval(() => {
        count--;
        this.store.countdownValue = count;
        if (count <= 0) {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });
  }

  private startTimer() {
    this.startTime = Date.now();
    this.pausedDuration = 0;
    this.timerInterval = setInterval(() => {
      if (this.store.isRecording) {
        this.store.elapsedSeconds = Math.floor((Date.now() - this.startTime - this.pausedDuration) / 1000);
      }
    }, 200);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private mergeStreams(videoStreams: MediaStream[], audioStreams: MediaStream[]): MediaStream {
    const tracks: MediaStreamTrack[] = [];

    // Video: take from first stream that has video
    for (const stream of videoStreams) {
      const vt = stream.getVideoTracks();
      if (vt.length > 0) {
        tracks.push(vt[0]);
        break;
      }
    }

    // Audio: merge all audio sources via AudioContext
    if (audioStreams.length === 1) {
      const at = audioStreams[0].getAudioTracks();
      if (at.length > 0) tracks.push(at[0]);
    } else if (audioStreams.length > 1) {
      try {
        const audioCtx = new AudioContext();
        const destination = audioCtx.createMediaStreamDestination();
        for (const stream of audioStreams) {
          if (stream.getAudioTracks().length > 0) {
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(destination);
          }
        }
        const mergedAudio = destination.stream.getAudioTracks();
        if (mergedAudio.length > 0) tracks.push(mergedAudio[0]);
      } catch {
        // Fallback: use first audio stream
        const at = audioStreams[0].getAudioTracks();
        if (at.length > 0) tracks.push(at[0]);
      }
    }

    return new MediaStream(tracks);
  }

  private getSupportedMimeType(): string {
    // Prefer H.264 for better real-time quality + wider compatibility
    // Then VP9, then VP8 as fallbacks
    const types = [
      'video/webm;codecs=h264,opus',
      'video/mp4;codecs=h264,aac',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
  }

  private getBitrate(quality: string, isComposited: boolean): number {
    // Higher bitrates for crisp screen recording
    // Screen content (text, UI) needs more bitrate than webcam
    const base = (() => {
      switch (quality) {
        case '1080p': return 12_000_000; // 12 Mbps
        case '720p': return 6_000_000;   // 6 Mbps
        case '480p': return 3_000_000;   // 3 Mbps
        default: return 8_000_000;
      }
    })();
    // Composited needs extra bitrate due to canvas re-encoding
    return isComposited ? Math.floor(base * 1.2) : base;
  }

  private async generateThumbnail(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(blob);
      video.src = url;

      video.onloadeddata = () => {
        video.currentTime = Math.min(1, video.duration / 2);
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };

      // Timeout fallback
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve('');
      }, 5000);
    });
  }
}
