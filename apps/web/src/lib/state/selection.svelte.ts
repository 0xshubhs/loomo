export class SelectionStore {
	selectedClipIds = $state<Set<string>>(new Set());
	selectedTrackId = $state<string | null>(null);
	selectedTransitionId = $state<string | null>(null);
	selectedTextId = $state<string | null>(null);

	get hasSelection(): boolean {
		return this.selectedClipIds.size > 0 || this.selectedTransitionId !== null || this.selectedTextId !== null;
	}

	get multiSelect(): boolean {
		return this.selectedClipIds.size > 1;
	}

	selectClip(id: string, additive: boolean = false): void {
		if (!additive) this.selectedClipIds = new Set();
		const next = new Set(this.selectedClipIds);
		next.add(id);
		this.selectedClipIds = next;
		this.selectedTransitionId = null;
		this.selectedTextId = null;
	}

	deselectClip(id: string): void {
		const next = new Set(this.selectedClipIds);
		next.delete(id);
		this.selectedClipIds = next;
	}

	selectTrack(id: string): void {
		this.selectedTrackId = id;
	}

	selectTransition(id: string): void {
		this.selectedClipIds = new Set();
		this.selectedTransitionId = id;
		this.selectedTextId = null;
	}

	selectText(id: string): void {
		this.selectedClipIds = new Set();
		this.selectedTransitionId = null;
		this.selectedTextId = id;
	}

	deselectAll(): void {
		this.selectedClipIds = new Set();
		this.selectedTrackId = null;
		this.selectedTransitionId = null;
		this.selectedTextId = null;
	}
}
