export async function generateThumbnailsFromVideo(
	blobUrl: string,
	duration: number,
	count: number = 10,
	thumbWidth: number = 160,
	thumbHeight: number = 90
): Promise<string[]> {
	if (duration <= 0) return [];

	return new Promise((resolve) => {
		const video = document.createElement('video');
		video.preload = 'auto';
		video.muted = true;

		const canvas = document.createElement('canvas');
		canvas.width = thumbWidth;
		canvas.height = thumbHeight;
		const ctx = canvas.getContext('2d')!;

		const thumbnails: string[] = [];
		const interval = duration / count;
		let currentIndex = 0;

		video.onseeked = () => {
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			canvas.toBlob(
				(blob) => {
					if (blob) {
						thumbnails.push(URL.createObjectURL(blob));
					}
					currentIndex++;
					if (currentIndex < count) {
						video.currentTime = Math.min(currentIndex * interval, duration - 0.1);
					} else {
						resolve(thumbnails);
					}
				},
				'image/jpeg',
				0.6
			);
		};

		video.onloadeddata = () => {
			video.currentTime = 0.1;
		};

		video.onerror = () => resolve([]);
		video.src = blobUrl;
	});
}

export function revokeThumbnails(thumbnails: string[]): void {
	for (const url of thumbnails) {
		URL.revokeObjectURL(url);
	}
}
