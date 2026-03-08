import type { CameraBubblePosition } from '$lib/types/recorder.js';

export class CanvasCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement;
  private cameraVideo: HTMLVideoElement | null = null;
  private animationId: number | null = null;
  private bubblePosition: CameraBubblePosition = { x: 85, y: 85 };
  private bubbleRadius = 64;
  private outputStream: MediaStream | null = null;

  constructor(private width: number, private height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;

    this.screenVideo = document.createElement('video');
    this.screenVideo.muted = true;
    this.screenVideo.playsInline = true;
  }

  setScreenSource(stream: MediaStream) {
    this.screenVideo.srcObject = stream;
    this.screenVideo.play();
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
    const { ctx, width, height } = this;

    // Draw screen
    if (this.screenVideo.readyState >= 2) {
      ctx.drawImage(this.screenVideo, 0, 0, width, height);
    }

    // Draw camera bubble
    if (this.cameraVideo && this.cameraVideo.readyState >= 2) {
      const r = this.bubbleRadius;
      const cx = (this.bubblePosition.x / 100) * width;
      const cy = (this.bubblePosition.y / 100) * height;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      // Draw camera frame (mirrored)
      ctx.translate(cx + r, cy - r);
      ctx.scale(-1, 1);
      ctx.drawImage(this.cameraVideo, 0, 0, r * 2, r * 2);
      ctx.restore();

      // Border
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    this.animationId = requestAnimationFrame(this.drawFrame);
  };
}
