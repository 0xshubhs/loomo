import { formatTimecode } from '$lib/utils/time.js';

export class PlaybackStore {
	playing = $state<boolean>(false);
	currentTime = $state<number>(0);
	playbackRate = $state<number>(1);
	loopEnabled = $state<boolean>(false);
	loopStart = $state<number>(0);
	loopEnd = $state<number>(0);
	volume = $state<number>(1);
	/**
	 * Master mute for the preview.
	 *
	 * Separate from `volume` so unmuting returns to the level that was set,
	 * rather than to full.
	 */
	muted = $state<boolean>(false);

	/** Master gain the preview should apply on top of track and clip volume. */
	get outputVolume(): number {
		return this.muted ? 0 : Math.max(0, Math.min(1, this.volume));
	}

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

	toggleMute(): void {
		this.muted = !this.muted;
	}

	setVolume(volume: number): void {
		this.volume = Math.max(0, Math.min(1, volume));
		// Nudging the slider off zero is a request to hear something.
		if (this.volume > 0) this.muted = false;
	}

	setRate(rate: number): void {
		this.playbackRate = rate;
	}

	stepForward(fps: number): void {
		this.seek(this.currentTime + 1 / fps);
	}

	stepBackward(fps: number): void {
		this.seek(this.currentTime - 1 / fps);
	}
}
