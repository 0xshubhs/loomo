export interface MediaMetadata {
	duration: number;
	width: number;
	height: number;
	fps: number;
	codec: string;
	audioCodec: string;
	bitrate: number;
	fileSize: number;
	format: string;
}

export interface MediaAsset {
	id: string;
	name: string;
	file: File;
	blobUrl: string;
	type: 'video' | 'audio' | 'image';
	metadata: MediaMetadata;
	thumbnails: string[];
	waveform: Float32Array | null;
	addedAt: number;
}

export interface ImportProgress {
	assetId: string;
	stage: 'reading' | 'probing' | 'thumbnails' | 'waveform' | 'done';
	progress: number;
}
