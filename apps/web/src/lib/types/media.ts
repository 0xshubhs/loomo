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

/**
 * Where a stock asset came from and what its licence obliges.
 *
 * Carried on the asset rather than looked up later, because the credit has to
 * survive right through to the finished project — by the time someone
 * publishes, the search that found the track is long gone.
 */
export interface AssetAttribution {
	/** Licence code as the provider reports it, e.g. "cc0", "by". */
	licence: string;
	/** Display form, e.g. "CC BY 4.0". */
	licenceLabel: string;
	licenceUrl: string;
	creator: string;
	creatorUrl: string | null;
	sourceUrl: string;
	provider: string;
	/** False for public-domain equivalents, which need no credit line. */
	required: boolean;
	/** Ready-to-paste credit line. */
	text: string;
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
	/** Present only on assets pulled from a stock provider. */
	attribution?: AssetAttribution;
	/**
	 * Filename of this asset's copy in the desktop scratch directory, set at
	 * import. Lets the bundled ffmpeg decode preview frames straight from
	 * disk — the webview's own video pipeline is not reliable enough to
	 * preview through on Linux.
	 */
	scratchName?: string;
}

export interface ImportProgress {
	assetId: string;
	stage: 'reading' | 'probing' | 'thumbnails' | 'waveform' | 'done';
	progress: number;
}
