import type { AspectRatio } from '$lib/types/project.js';
import { DEFAULT_ASPECT_RATIO } from '$lib/utils/aspect-ratios.js';

export class ProjectStore {
	name = $state<string>('Untitled Project');
	createdAt = $state<number>(Date.now());
	dirty = $state<boolean>(false);
	/**
	 * Where this project lives on disk.
	 *
	 * Assigned when the editor opens, before anything is saved: minting the id
	 * up front means there is exactly one editor route, and an unsaved project
	 * is simply an id with nothing written under it yet.
	 */
	id = $state<string | null>(null);
	/** When it was last written, or 0 if it never has been. */
	savedAt = $state<number>(0);
	saving = $state<boolean>(false);
	aspectRatio = $state<AspectRatio>({
		width: DEFAULT_ASPECT_RATIO.width,
		height: DEFAULT_ASPECT_RATIO.height,
		label: DEFAULT_ASPECT_RATIO.label,
	});

	markDirty(): void {
		this.dirty = true;
	}

	setAspectRatio(ratio: AspectRatio): void {
		this.aspectRatio = ratio;
		this.markDirty();
	}

	markSaved(at: number): void {
		this.savedAt = at;
		this.dirty = false;
	}

	reset(): void {
		this.name = 'Untitled Project';
		this.createdAt = Date.now();
		this.dirty = false;
		this.id = null;
		this.savedAt = 0;
		this.aspectRatio = {
			width: DEFAULT_ASPECT_RATIO.width,
			height: DEFAULT_ASPECT_RATIO.height,
			label: DEFAULT_ASPECT_RATIO.label,
		};
	}
}
