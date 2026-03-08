export interface AudioMixSettings {
	trackId: string;
	volume: number;
	pan: number;
	muted: boolean;
}

export interface AudioPeak {
	time: number;
	amplitude: number;
}
