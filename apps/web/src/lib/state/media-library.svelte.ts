import type { MediaAsset } from '$lib/types/index.js';

export class MediaLibraryStore {
	assets = $state<MediaAsset[]>([]);
	importing = $state<boolean>(false);
	importProgress = $state<number>(0);

	getAssetById(id: string): MediaAsset | undefined {
		return this.assets.find((a) => a.id === id);
	}

	addAsset(asset: MediaAsset): void {
		this.assets.push(asset);
	}

	removeAsset(id: string): void {
		const asset = this.getAssetById(id);
		if (asset) {
			URL.revokeObjectURL(asset.blobUrl);
			for (const thumb of asset.thumbnails) {
				URL.revokeObjectURL(thumb);
			}
		}
		this.assets = this.assets.filter((a) => a.id !== id);
	}

	clear(): void {
		for (const asset of this.assets) {
			URL.revokeObjectURL(asset.blobUrl);
			for (const thumb of asset.thumbnails) {
				URL.revokeObjectURL(thumb);
			}
		}
		this.assets = [];
	}
}
