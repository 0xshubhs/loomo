import type { CameraBubblePosition } from '$lib/types/recorder.js';

export class CanvasCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement;
  private cameraVideo: HTMLVideoElement | null = null;
  private animationId: number | null = null;
  private bubblePosition: CameraBubblePosition = { x: 85, y: 85 };
  private bubbleRadius = 80;
  private outputStream: MediaStream | null = null;
  private targetWidth: number;
  private targetHeight: number;

  constructor(width: number, height: number) {
    this.targetWidth = width;
    this.targetHeight = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    })!;
    // High quality rendering
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    this.screenVideo = document.createElement('video');
    this.screenVideo.muted = true;
    this.screenVideo.playsInline = true;
  }

  setScreenSource(stream: MediaStream) {
    this.screenVideo.srcObject = stream;
    this.screenVideo.play();

    // Match canvas to actual screen capture resolution
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      if (settings.width && settings.height) {
        // Use actual captured resolution, capped at target
        const w = Math.min(settings.width, this.targetWidth);
        const h = Math.min(settings.height, this.targetHeight);
        this.canvas.width = w;
        this.canvas.height = h;
        // Scale bubble radius proportionally
        this.bubbleRadius = Math.round(Math.min(w, h) * 0.08);
      }
    }
  }

  setCameraSource(stream: MediaStream | null) {
    if (!stream) {
      this.cameraVideo = null;
      return;
    }
    this.cameraVideo = document.createElement('video');
    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.cameraVideo.srcObject = stream;
    this.cameraVideo.play();
  }

  setCameraBubblePosition(x: number, y: number) {
    this.bubblePosition = { x, y };
  }

  setCameraBubbleSize(radius: number) {
    this.bubbleRadius = radius;
  }

  start(): MediaStream {
    this.drawFrame();
    this.outputStream = this.canvas.captureStream(30);
    return this.outputStream;
  }

  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.screenVideo.pause();
    this.screenVideo.srcObject = null;
    if (this.cameraVideo) {
      this.cameraVideo.pause();
      this.cameraVideo.srcObject = null;
    }
    this.outputStream = null;
  }

  private drawFrame = () => {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Draw screen - fill canvas maintaining aspect ratio
    if (this.screenVideo.readyState >= 2) {
      const vw = this.screenVideo.videoWidth;
      const vh = this.screenVideo.videoHeight;
      // Scale to fill (cover), then center
      const scale = Math.max(w / vw, h / vh);
      const sw = vw * scale;
      const sh = vh * scale;
      const sx = (w - sw) / 2;
      const sy = (h - sh) / 2;
      ctx.drawImage(this.screenVideo, sx, sy, sw, sh);
    }

    // Draw camera bubble
    if (this.cameraVideo && this.cameraVideo.readyState >= 2) {
      const r = this.bubbleRadius;
      const margin = r + 20;
      const cx = margin + ((this.bubblePosition.x / 100) * (w - margin * 2));
      const cy = margin + ((this.bubblePosition.y / 100) * (h - margin * 2));

      ctx.save();

      // Shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;

      // Clip to circle
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      // Draw camera frame (mirrored) - cover the circle
      const camW = this.cameraVideo.videoWidth;
      const camH = this.cameraVideo.videoHeight;
      const camScale = Math.max((r * 2) / camW, (r * 2) / camH);
      const drawW = camW * camScale;
      const drawH = camH * camScale;

      ctx.translate(cx, cy);
      ctx.scale(-1, 1); // Mirror
      ctx.drawImage(this.cameraVideo, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      // White border
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    this.animationId = requestAnimationFrame(this.drawFrame);
  };
}
