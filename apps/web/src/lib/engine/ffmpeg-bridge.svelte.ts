type OperationCallback = {
	onProgress?: (progress: number) => void;
	onLog?: (message: string) => void;
};

interface PendingOp {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	callbacks: OperationCallback;
}

export class FFmpegBridge {
	private worker: Worker | null = null;
	private pendingOps = new Map<string, PendingOp>();
	private opCounter = 0;

	ready = $state<boolean>(false);
	busy = $state<boolean>(false);
	currentOperation = $state<string | null>(null);
	initProgress = $state<string>('');

	async initialize(): Promise<void> {
		this.initProgress = 'Loading FFmpeg...';
		this.worker = new Worker(new URL('./ffmpeg-worker.ts', import.meta.url), {
			type: 'module',
		});

		this.worker.onmessage = (e) => this.handleMessage(e.data);

		return new Promise<void>((resolve, reject) => {
			this.pendingOps.set('init', { resolve, reject, callbacks: {} });
			this.worker!.postMessage({
				type: 'init',
				payload: { multithreaded: typeof SharedArrayBuffer !== 'undefined' },
			});
		});
	}

	private handleMessage(msg: any): void {
		switch (msg.type) {
			case 'ready':
				this.ready = true;
				this.initProgress = 'Ready';
				this.pendingOps.get('init')?.resolve(undefined);
				this.pendingOps.delete('init');
				break;

			case 'progress': {
				const op = this.pendingOps.get(msg.payload.id);
				op?.callbacks.onProgress?.(msg.payload.progress);
				break;
			}

			case 'log': {
				const op = this.pendingOps.get(msg.payload.id);
				op?.callbacks.onLog?.(msg.payload.message);
				break;
			}

			case 'result': {
				const op = this.pendingOps.get(msg.payload.id);
				op?.resolve(msg.payload.exitCode);
				this.pendingOps.delete(msg.payload.id);
				this.busy = false;
				this.currentOperation = null;
				break;
			}

			case 'fileData': {
				const op = this.pendingOps.get(msg.payload.id);
				op?.resolve(msg.payload.data);
				this.pendingOps.delete(msg.payload.id);
				break;
			}

			case 'error': {
				const op = this.pendingOps.get(msg.payload.id);
				op?.reject(new Error(msg.payload.error));
				this.pendingOps.delete(msg.payload.id);
				this.busy = false;
				this.currentOperation = null;
				break;
			}
		}
	}

	private nextId(): string {
		return `op-${++this.opCounter}`;
	}

	async exec(args: string[], callbacks: OperationCallback = {}): Promise<number> {
		if (!this.worker) throw new Error('FFmpeg not initialized');
		const id = this.nextId();
		this.busy = true;
		this.currentOperation = args.join(' ').slice(0, 100);

		return new Promise<number>((resolve, reject) => {
			this.pendingOps.set(id, { resolve, reject, callbacks });
			this.worker!.postMessage({ type: 'exec', payload: { id, args } });
		});
	}

	async writeFile(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		if (!this.worker) throw new Error('FFmpeg not initialized');
		const buffer = data instanceof Uint8Array ? data.buffer : data;
		this.worker.postMessage({ type: 'writeFile', payload: { path, data: buffer } }, [buffer]);
	}

	async readFile(path: string): Promise<ArrayBuffer> {
		if (!this.worker) throw new Error('FFmpeg not initialized');
		const id = this.nextId();

		return new Promise<ArrayBuffer>((resolve, reject) => {
			this.pendingOps.set(id, { resolve, reject, callbacks: {} });
			this.worker!.postMessage({ type: 'readFile', payload: { id, path } });
		});
	}

	async deleteFile(path: string): Promise<void> {
		if (!this.worker) throw new Error('FFmpeg not initialized');
		this.worker.postMessage({ type: 'deleteFile', payload: { path } });
	}

	terminate(): void {
		this.worker?.terminate();
		this.worker = null;
		this.ready = false;
		this.busy = false;
	}
}
