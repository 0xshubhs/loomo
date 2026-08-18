import { scanDevices } from '$lib/recorder/devices.js';
import type { RecordingMode, RecordingState, RecordingQuality, DeviceInfo, RecordingResult, CameraBubblePosition } from '$lib/types/recorder.js';

export class RecorderStore {
  mode = $state<RecordingMode>('screen-cam');
  recordingState = $state<RecordingState>('idle');
  quality = $state<RecordingQuality>('1080p');
  cameras = $state<DeviceInfo[]>([]);
  microphones = $state<DeviceInfo[]>([]);
  selectedCameraId = $state<string | null>(null);
  selectedMicId = $state<string | null>(null);
  systemAudioEnabled = $state<boolean>(true);
  elapsedSeconds = $state<number>(0);
  countdownValue = $state<number>(0);
  cameraBubblePosition = $state<CameraBubblePosition>({ x: 85, y: 85 });
  cameraBubbleSize = $state<'sm' | 'md' | 'lg'>('md');
  cameraBubbleVisible = $state<boolean>(true);
  cameraStream = $state<MediaStream | null>(null);
  result = $state<RecordingResult | null>(null);
  error = $state<string | null>(null);

  get isRecording() { return this.recordingState === 'recording'; }
  get isPaused() { return this.recordingState === 'paused'; }
  get showCamera() { return this.mode !== 'screen-only' && this.mode !== 'audio' && this.cameraBubbleVisible; }

  get formattedTime(): string {
    const h = Math.floor(this.elapsedSeconds / 3600);
    const m = Math.floor((this.elapsedSeconds % 3600) / 60);
    const s = Math.floor(this.elapsedSeconds % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  get isAudioOnly() { return this.mode === 'audio'; }

  setMode(mode: RecordingMode) {
    this.mode = mode;
    if (mode === 'screen-only' || mode === 'audio') this.cameraBubbleVisible = false;
    else this.cameraBubbleVisible = true;
  }

  startCountdown() {
    this.recordingState = 'countdown';
    this.countdownValue = 3;
  }

  startRecording() {
    this.recordingState = 'recording';
    this.elapsedSeconds = 0;
  }

  pauseRecording() { this.recordingState = 'paused'; }
  resumeRecording() { this.recordingState = 'recording'; }

  stopRecording() {
    this.recordingState = 'processing';
    this.cleanupCameraStream();
  }

  setResult(result: RecordingResult) {
    this.result = result;
    this.recordingState = 'done';
  }

  setError(error: string) {
    this.error = error;
    this.recordingState = 'error';
  }

  reset() {
    this.cleanupCameraStream();
    this.recordingState = 'idle';
    this.elapsedSeconds = 0;
    this.countdownValue = 0;
    this.result = null;
    this.error = null;
  }

  cleanupCameraStream() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    }
  }

  /**
   * Why the device list came back short, in the user's words rather than the
   * browser's — `NotAllowedError` reads as "the user denied permission" even
   * when no prompt was ever shown.
   */
  deviceError = $state<string | null>(null);

  async enumerateDevices() {
    const scan = await scanDevices(navigator.mediaDevices);

    this.cameras = scan.cameras;
    this.microphones = scan.microphones;
    this.deviceError = scan.error;

    if (this.cameras.length > 0 && !this.selectedCameraId) {
      this.selectedCameraId = this.cameras[0].deviceId;
    }
    if (this.microphones.length > 0 && !this.selectedMicId) {
      this.selectedMicId = this.microphones[0].deviceId;
    }
  }
}
