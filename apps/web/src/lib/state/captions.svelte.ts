import type { CaptionTrack, CaptionSegment, CaptionStyle } from '$lib/types/index.js';
import { DEFAULT_CAPTION_STYLE } from '$lib/types/index.js';

export class CaptionStore {
	captionTrack = $state<CaptionTrack>({
		segments: [],
		style: { ...DEFAULT_CAPTION_STYLE },
		enabled: true,
	});

	get hasSegments(): boolean {
		return this.captionTrack.segments.length > 0;
	}

	get isEnabled(): boolean {
		return this.captionTrack.enabled && this.captionTrack.segments.length > 0;
	}

	setCaptions(segments: CaptionSegment[]): void {
		this.captionTrack.segments = segments;
	}

	updateCaptionStyle(style: Partial<CaptionStyle>): void {
		this.captionTrack.style = { ...this.captionTrack.style, ...style };
	}

	clearCaptions(): void {
		this.captionTrack.segments = [];
	}

	toggleCaptions(): void {
		this.captionTrack.enabled = !this.captionTrack.enabled;
	}

	updateSegmentText(segmentId: string, text: string): void {
		const seg = this.captionTrack.segments.find((s) => s.id === segmentId);
		if (seg) {
			seg.text = text;
		}
	}

	getActiveSegment(currentTime: number): CaptionSegment | null {
		if (!this.captionTrack.enabled) return null;
		return this.captionTrack.segments.find(
			(s) => currentTime >= s.startTime && currentTime <= s.endTime
		) ?? null;
	}
}
