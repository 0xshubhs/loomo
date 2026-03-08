export class FrameScheduler {
	private rafId: number | null = null;
	private callback: ((dt: number) => void) | null = null;
	private lastTime = 0;
	private running = false;

	start(callback: (dt: number) => void): void {
		if (this.running) this.stop();
		this.callback = callback;
		this.running = true;
		this.lastTime = performance.now();
		this.tick(this.lastTime);
	}

	private tick = (now: number): void => {
		if (!this.running) return;
		const dt = (now - this.lastTime) / 1000;
		this.lastTime = now;
		this.callback?.(dt);
		this.rafId = requestAnimationFrame(this.tick);
	};

	stop(): void {
		this.running = false;
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	get isRunning(): boolean {
		return this.running;
	}
}
