import type { AspectRatio } from '$lib/types/project.js';
import { DEFAULT_ASPECT_RATIO } from '$lib/utils/aspect-ratios.js';

export class ProjectStore {
	name = $state<string>('Untitled Project');
	createdAt = $state<number>(Date.now());
	dirty = $state<boolean>(false);
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

	reset(): void {
		this.name = 'Untitled Project';
		this.createdAt = Date.now();
		this.dirty = false;
		this.aspectRatio = {
			width: DEFAULT_ASPECT_RATIO.width,
			height: DEFAULT_ASPECT_RATIO.height,
			label: DEFAULT_ASPECT_RATIO.label,
		};
	}
}
