export class ProjectStore {
	name = $state<string>('Untitled Project');
	createdAt = $state<number>(Date.now());
	dirty = $state<boolean>(false);

	markDirty(): void {
		this.dirty = true;
	}

	reset(): void {
		this.name = 'Untitled Project';
		this.createdAt = Date.now();
		this.dirty = false;
	}
}
