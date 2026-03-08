import { formatTimecode } from '$lib/utils/time.js';

export class PlaybackStore {
	playing = $state<boolean>(false);
	currentTime = $state<number>(0);
	playbackRate = $state<number>(1);
	loopEnabled = $state<boolean>(false);
	loopStart = $state<number>(0);
	loopEnd = $state<number>(0);
	volume = $state<number>(1);

	get formattedTime(): string {
		return formatTimecode(this.currentTime);
	}

	play(): void {
		this.playing = true;
	}

	pause(): void {
		this.playing = false;
	}

	toggle(): void {
		this.playing = !this.playing;
	}

	seek(time: number): void {
		this.currentTime = Math.max(0, time);
	}

	seekRelative(delta: number): void {
		this.seek(this.currentTime + delta);
	}

	goToStart(): void {
		this.currentTime = 0;
	}

	setRate(rate: number): void {
		this.playbackRate = rate;
	}
}
