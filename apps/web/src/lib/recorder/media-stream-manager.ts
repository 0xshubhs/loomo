export class MediaStreamManager {
  private screenStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;

  async requestScreenCapture(systemAudio: boolean): Promise<MediaStream> {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: systemAudio ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
      } : false,
    } as DisplayMediaStreamOptions);
    return this.screenStream;
  }

  async requestCamera(deviceId: string | null): Promise<MediaStream> {
    this.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 720 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
    });
    return this.cameraStream;
  }

  async requestMicrophone(deviceId: string | null): Promise<MediaStream> {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
      },
    });
    return this.micStream;
  }

  getScreenStream() { return this.screenStream; }
  getCameraStream() { return this.cameraStream; }
  getMicStream() { return this.micStream; }

  stopAllStreams() {
    [this.screenStream, this.cameraStream, this.micStream].forEach(stream => {
      stream?.getTracks().forEach(t => t.stop());
    });
    this.screenStream = null;
    this.cameraStream = null;
    this.micStream = null;
  }
}
