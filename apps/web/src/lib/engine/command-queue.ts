interface QueuedOperation {
	id: string;
	priority: number;
	execute: () => Promise<void>;
}

export class FFmpegCommandQueue {
	private queue: QueuedOperation[] = [];
	private processing = false;
	private currentOp: QueuedOperation | null = null;

	enqueue(op: QueuedOperation): void {
		this.queue.push(op);
		this.queue.sort((a, b) => a.priority - b.priority);
		this.processNext();
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;
		this.processing = true;
		this.currentOp = this.queue.shift()!;

		try {
			await this.currentOp.execute();
		} catch (error) {
			console.error(`FFmpeg operation ${this.currentOp.id} failed:`, error);
		} finally {
			this.currentOp = null;
			this.processing = false;
			this.processNext();
		}
	}

	cancelAll(): void {
		this.queue = [];
	}

	get isProcessing(): boolean {
		return this.processing;
	}

	get queueLength(): number {
		return this.queue.length;
	}
}
