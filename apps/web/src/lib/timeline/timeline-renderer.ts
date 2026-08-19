import type { Track, Clip } from '$lib/types/index.js';
import type { Transition, TextOverlay, ShapeOverlay, Marker } from '$lib/types/index.js';
import { formatDuration } from '$lib/utils/time.js';

export interface RenderState {
	tracks: Track[];
	transitions: Transition[];
	textOverlays: TextOverlay[];
	shapeOverlays: ShapeOverlay[];
	pixelsPerSecond: number;
	scrollX: number;
	scrollY: number;
	currentTime: number;
	selectedClipIds: Set<string>;
	selectedTransitionId: string | null;
	duration: number;
	snapLine: number | null;
	/** Clip under the cursor, so trim handles can be shown before selecting. */
	hoveredClipId?: string | null;
	markers?: Marker[];
}

const COLORS = {
	background: '#0a0a0a',
	trackBg: '#161616',
	trackBgAlt: '#111111',
	clipBody: '#2a2a2a',
	clipBodySelected: '#333344',
	clipBorder: '#444444',
	clipBorderSelected: '#888888',
	clipBodyHover: '#303030',
	waveform: '#555555',
	waveformBg: '#1a1a2a',
	playhead: '#ff4444',
	ruler: '#1a1a1a',
	rulerText: '#666666',
	rulerMajor: '#444444',
	rulerMinor: '#2a2a2a',
	snapLine: '#ffaa00',
	transition: '#444455',
	textOverlay: '#334433',
	shapeOverlay: '#333355',
	selection: 'rgba(255, 255, 255, 0.05)',
	trimHandle: '#ffffff',
	trackSeparator: '#222222',
	clipName: '#cccccc',
	clipTime: '#888888',
} as const;

const GROUP_COLORS = [
	'#ff6b6b', '#4ecdc4', '#ffe66d', '#a06cd5',
	'#ff9ff3', '#54a0ff', '#5f27cd', '#01a3a4',
	'#f368e0', '#ff9f43', '#ee5a24', '#0abde3',
] as const;

function getGroupColor(groupId: string): string {
	let hash = 0;
	for (let i = 0; i < groupId.length; i++) {
		hash = ((hash << 5) - hash + groupId.charCodeAt(i)) | 0;
	}
	return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

const RULER_HEIGHT = 30;
const MARKER_FLAG_HEIGHT = 12;
const MARKER_FLAG_WIDTH = 9;
const MARKER_LABEL_MAX_WIDTH = 90;
const TRACK_HEIGHT = 80;
const TRACK_GAP = 1;

export class TimelineRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private thumbnailCache = new Map<string, HTMLImageElement>();
	private animFrameId: number | null = null;
	private dirty = true;
	private renderState: RenderState | null = null;
	private dpr = 1;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d')!;
		this.dpr = window.devicePixelRatio || 1;
		this.resize();
	}

	resize(): void {
		this.dpr = window.devicePixelRatio || 1;
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = rect.width * this.dpr;
		this.canvas.height = rect.height * this.dpr;
		this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.dirty = true;
	}

	update(state: RenderState): void {
		this.renderState = state;
		this.dirty = true;
	}

	loadThumbnail(clipId: string, url: string): void {
		if (this.thumbnailCache.has(clipId)) return;
		const img = new Image();
		img.onload = () => {
			this.thumbnailCache.set(clipId, img);
			this.dirty = true;
		};
		img.src = url;
	}

	startRenderLoop(): void {
		const loop = () => {
			if (this.dirty && this.renderState) {
				this.render(this.renderState);
				this.dirty = false;
			}
			this.animFrameId = requestAnimationFrame(loop);
		};
		this.animFrameId = requestAnimationFrame(loop);
	}

	stopRenderLoop(): void {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
	}

	markDirty(): void {
		this.dirty = true;
	}

	private render(state: RenderState): void {
		const { ctx } = this;
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;

		// Clear
		ctx.fillStyle = COLORS.background;
		ctx.fillRect(0, 0, width, height);

		this.renderRuler(ctx, width, state);
		this.renderTracks(ctx, width, height, state);
		this.renderTransitions(ctx, state);
		this.renderTextOverlayMarkers(ctx, state);
		this.renderShapeOverlayMarkers(ctx, state);
		this.renderMarkers(ctx, height, state);
		this.renderPlayhead(ctx, height, state);

		if (state.snapLine !== null) {
			this.renderSnapLine(ctx, height, state);
		}
	}

	private renderRuler(ctx: CanvasRenderingContext2D, width: number, state: RenderState): void {
		ctx.fillStyle = COLORS.ruler;
		ctx.fillRect(0, 0, width, RULER_HEIGHT);

		const pps = state.pixelsPerSecond;
		const startTime = state.scrollX / pps;
		const endTime = (state.scrollX + width) / pps;

		// Determine tick interval based on zoom
		let majorInterval = 1;
		if (pps < 20) majorInterval = 10;
		else if (pps < 50) majorInterval = 5;
		else if (pps < 100) majorInterval = 2;
		else if (pps > 200) majorInterval = 0.5;

		const minorInterval = majorInterval / 5;

		// Minor ticks
		ctx.strokeStyle = COLORS.rulerMinor;
		ctx.lineWidth = 1;
		for (let t = Math.floor(startTime / minorInterval) * minorInterval; t <= endTime; t += minorInterval) {
			const x = Math.round(t * pps - state.scrollX) + 0.5;
			ctx.beginPath();
			ctx.moveTo(x, RULER_HEIGHT - 5);
			ctx.lineTo(x, RULER_HEIGHT);
			ctx.stroke();
		}

		// Major ticks + labels
		ctx.strokeStyle = COLORS.rulerMajor;
		ctx.fillStyle = COLORS.rulerText;
		ctx.font = '10px Inter, sans-serif';
		ctx.textAlign = 'center';

		for (let t = Math.floor(startTime / majorInterval) * majorInterval; t <= endTime; t += majorInterval) {
			const x = Math.round(t * pps - state.scrollX) + 0.5;
			ctx.beginPath();
			ctx.moveTo(x, RULER_HEIGHT - 12);
			ctx.lineTo(x, RULER_HEIGHT);
			ctx.stroke();
			ctx.fillText(formatDuration(Math.max(0, t)), x, RULER_HEIGHT - 15);
		}

		// Bottom border
		ctx.strokeStyle = COLORS.trackSeparator;
		ctx.beginPath();
		ctx.moveTo(0, RULER_HEIGHT);
		ctx.lineTo(width, RULER_HEIGHT);
		ctx.stroke();
	}

	private renderTracks(
		ctx: CanvasRenderingContext2D,
		width: number,
		_height: number,
		state: RenderState
	): void {
		for (let i = 0; i < state.tracks.length; i++) {
			const track = state.tracks[i];
			const y = RULER_HEIGHT + i * (TRACK_HEIGHT + TRACK_GAP) - state.scrollY;

			// Track background
			ctx.fillStyle = i % 2 === 0 ? COLORS.trackBg : COLORS.trackBgAlt;
			ctx.fillRect(0, y, width, TRACK_HEIGHT);

			// Track separator
			ctx.strokeStyle = COLORS.trackSeparator;
			ctx.beginPath();
			ctx.moveTo(0, y + TRACK_HEIGHT);
			ctx.lineTo(width, y + TRACK_HEIGHT);
			ctx.stroke();

			// Clips
			if (!track.muted || track.type === 'video') {
				for (const clip of track.clips) {
					this.renderClip(ctx, clip, y, state);
				}
			}
		}
	}

	private renderClip(
		ctx: CanvasRenderingContext2D,
		clip: Clip,
		trackY: number,
		state: RenderState
	): void {
		const x = clip.timelineStart * state.pixelsPerSecond - state.scrollX;
		const w = clip.duration * state.pixelsPerSecond;
		const isSelected = state.selectedClipIds.has(clip.id);

		if (x + w < 0 || x > this.canvas.clientWidth) return; // Off-screen culling

		// Clip body
		ctx.fillStyle = isSelected ? COLORS.clipBodySelected : COLORS.clipBody;
		ctx.beginPath();
		ctx.roundRect(x + 1, trackY + 2, w - 2, TRACK_HEIGHT - 4, 4);
		ctx.fill();

		// Thumbnails for video clips
		if (clip.type === 'video') {
			const thumb = this.thumbnailCache.get(clip.assetId);
			if (thumb) {
				ctx.save();
				ctx.beginPath();
				ctx.roundRect(x + 1, trackY + 16, w - 2, TRACK_HEIGHT - 18, [0, 0, 4, 4]);
				ctx.clip();
				const thumbWidth = 80;
				const numThumbs = Math.ceil(w / thumbWidth);
				for (let i = 0; i < numThumbs; i++) {
					const tx = x + 1 + i * thumbWidth;
					try {
						ctx.drawImage(thumb, tx, trackY + 16, thumbWidth, TRACK_HEIGHT - 18);
					} catch {
						// Thumbnail may not be loaded
					}
				}
				ctx.restore();
			}
		}

		// Audio waveform placeholder for audio clips
		if (clip.type === 'audio') {
			ctx.fillStyle = COLORS.waveform;
			const barWidth = 2;
			const barGap = 1;
			const bars = Math.floor(w / (barWidth + barGap));
			for (let i = 0; i < bars; i++) {
				const bx = x + 2 + i * (barWidth + barGap);
				const barHeight = (Math.random() * 0.6 + 0.2) * (TRACK_HEIGHT - 20);
				const by = trackY + TRACK_HEIGHT / 2 - barHeight / 2 + 8;
				ctx.fillRect(bx, by, barWidth, barHeight);
			}
		}

		// Border
		ctx.strokeStyle = isSelected ? COLORS.clipBorderSelected : COLORS.clipBorder;
		ctx.lineWidth = isSelected ? 1.5 : 0.5;
		ctx.beginPath();
		ctx.roundRect(x + 1, trackY + 2, w - 2, TRACK_HEIGHT - 4, 4);
		ctx.stroke();
		ctx.lineWidth = 1;

		// Group indicator border
		if (clip.groupId) {
			const groupColor = getGroupColor(clip.groupId);
			ctx.strokeStyle = groupColor;
			ctx.lineWidth = 2;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.roundRect(x - 1, trackY, w + 2, TRACK_HEIGHT, 5);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineWidth = 1;

			// Small group indicator dot in top-right corner
			ctx.fillStyle = groupColor;
			ctx.beginPath();
			ctx.arc(x + w - 8, trackY + 8, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		// Clip name
		if (w > 30) {
			ctx.fillStyle = COLORS.clipName;
			ctx.font = '10px Inter, sans-serif';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			const maxTextWidth = w - 12;
			const displayName = clip.name.length > maxTextWidth / 5
				? clip.name.slice(0, Math.floor(maxTextWidth / 5)) + '...'
				: clip.name;
			ctx.fillText(displayName, x + 6, trackY + 5, maxTextWidth);
		}

		// Trim handles.
		//
		// These used to be 3px slivers at 0.6 alpha shown only once a clip was
		// selected, so the edges looked like plain borders and trimming was
		// effectively undiscoverable. They are now solid, grip-marked, and
		// appear on hover — before the user has committed to a selection.
		const isHovered = state.hoveredClipId === clip.id;
		if ((isSelected || isHovered) && w > 18) {
			const handleWidth = 7;
			const inset = 2;
			const handleHeight = TRACK_HEIGHT - inset * 2;

			ctx.fillStyle = COLORS.trimHandle;
			ctx.globalAlpha = isSelected ? 0.95 : 0.6;

            const roundedRect = (hx: number) => {
				ctx.beginPath();
				ctx.roundRect(hx, trackY + inset, handleWidth, handleHeight, 2);
				ctx.fill();
			};
			roundedRect(x + 1);
			roundedRect(x + w - handleWidth - 1);

			// Grip marks read as "draggable" the way a plain bar does not.
			ctx.globalAlpha = isSelected ? 0.5 : 0.35;
			ctx.fillStyle = '#000000';
			const gripTop = trackY + TRACK_HEIGHT / 2 - 5;
			for (const hx of [x + 1, x + w - handleWidth - 1]) {
				ctx.fillRect(hx + 2, gripTop, 1, 10);
				ctx.fillRect(hx + 4, gripTop, 1, 10);
			}

			ctx.globalAlpha = 1;
		}
	}

	private renderTransitions(ctx: CanvasRenderingContext2D, state: RenderState): void {
		for (const transition of state.transitions) {
			const clipA = state.tracks
				.flatMap((t) => t.clips)
				.find((c) => c.id === transition.clipAId);
			const clipB = state.tracks
				.flatMap((t) => t.clips)
				.find((c) => c.id === transition.clipBId);
			if (!clipA || !clipB) continue;

			const trackIndex = state.tracks.findIndex((t) => t.id === transition.trackId);
			if (trackIndex === -1) continue;

			const y = RULER_HEIGHT + trackIndex * (TRACK_HEIGHT + TRACK_GAP) - state.scrollY;
			const xStart = (clipA.timelineStart + clipA.duration - transition.duration) * state.pixelsPerSecond - state.scrollX;
			const w = transition.duration * state.pixelsPerSecond;

			const isSelected = state.selectedTransitionId === transition.id;
			ctx.fillStyle = isSelected ? '#555566' : COLORS.transition;
			ctx.globalAlpha = 0.6;
			ctx.fillRect(xStart, y + 2, w * 2, TRACK_HEIGHT - 4);
			ctx.globalAlpha = 1;

			// Diamond icon
			ctx.fillStyle = '#888888';
			const cx = xStart + w;
			const cy = y + TRACK_HEIGHT / 2;
			ctx.beginPath();
			ctx.moveTo(cx, cy - 6);
			ctx.lineTo(cx + 6, cy);
			ctx.lineTo(cx, cy + 6);
			ctx.lineTo(cx - 6, cy);
			ctx.closePath();
			ctx.fill();
		}
	}

	private renderTextOverlayMarkers(ctx: CanvasRenderingContext2D, state: RenderState): void {
		for (const overlay of state.textOverlays) {
			const trackIndex = state.tracks.findIndex((t) => t.id === overlay.trackId);
			if (trackIndex === -1) continue;

			const y = RULER_HEIGHT + trackIndex * (TRACK_HEIGHT + TRACK_GAP) - state.scrollY;
			const x = overlay.timelineStart * state.pixelsPerSecond - state.scrollX;
			const w = overlay.duration * state.pixelsPerSecond;

			ctx.fillStyle = COLORS.textOverlay;
			ctx.globalAlpha = 0.7;
			ctx.beginPath();
			ctx.roundRect(x, y + TRACK_HEIGHT - 20, w, 18, 3);
			ctx.fill();
			ctx.globalAlpha = 1;

			if (w > 20) {
				ctx.fillStyle = '#aaccaa';
				ctx.font = '9px Inter, sans-serif';
				ctx.textAlign = 'left';
				ctx.fillText('T: ' + overlay.text.slice(0, 15), x + 4, y + TRACK_HEIGHT - 7, w - 8);
			}
		}
	}

	private renderShapeOverlayMarkers(ctx: CanvasRenderingContext2D, state: RenderState): void {
		if (!state.shapeOverlays || state.shapeOverlays.length === 0) return;

		// Render shape markers on the first video track
		const videoTrackIndex = state.tracks.findIndex((t) => t.type === 'video');
		if (videoTrackIndex === -1) return;

		for (const shape of state.shapeOverlays) {
			const y = RULER_HEIGHT + videoTrackIndex * (TRACK_HEIGHT + TRACK_GAP) - state.scrollY;
			const x = shape.startTime * state.pixelsPerSecond - state.scrollX;
			const w = shape.duration * state.pixelsPerSecond;

			ctx.fillStyle = COLORS.shapeOverlay;
			ctx.globalAlpha = 0.7;
			ctx.beginPath();
			ctx.roundRect(x, y + TRACK_HEIGHT - 38, w, 16, 3);
			ctx.fill();
			ctx.globalAlpha = 1;

			if (w > 20) {
				ctx.fillStyle = '#aaaacc';
				ctx.font = '9px Inter, sans-serif';
				ctx.textAlign = 'left';
				ctx.fillText('S: ' + shape.shapeId, x + 4, y + TRACK_HEIGHT - 26, w - 8);
			}
		}
	}

	/**
	 * Markers: a flag in the ruler and a faint line down the tracks.
	 *
	 * The line is what makes them useful — a flag alone tells you a marker
	 * exists, a line tells you which frame of which clip it falls on. It is
	 * drawn under the playhead so the playhead stays the thing you follow.
	 */
	private renderMarkers(ctx: CanvasRenderingContext2D, height: number, state: RenderState): void {
		const markers = state.markers ?? [];
		if (markers.length === 0) return;

		const width = this.canvas.clientWidth;
		ctx.save();
		ctx.font = '10px Inter, sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';

		for (const marker of markers) {
			const x = Math.round(marker.time * state.pixelsPerSecond - state.scrollX) + 0.5;
			// Off-screen markers still cost a label measurement, and a long
			// timeline can hold a lot of them.
			if (x < -MARKER_LABEL_MAX_WIDTH || x > width) continue;

			ctx.strokeStyle = marker.color;
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x, RULER_HEIGHT);
			ctx.lineTo(x, height);
			ctx.stroke();

			ctx.globalAlpha = 1;
			ctx.fillStyle = marker.color;
			ctx.beginPath();
			ctx.moveTo(x, RULER_HEIGHT - MARKER_FLAG_HEIGHT);
			ctx.lineTo(x + MARKER_FLAG_WIDTH, RULER_HEIGHT - MARKER_FLAG_HEIGHT);
			ctx.lineTo(x + MARKER_FLAG_WIDTH - 3, RULER_HEIGHT - MARKER_FLAG_HEIGHT / 2);
			ctx.lineTo(x + MARKER_FLAG_WIDTH, RULER_HEIGHT);
			ctx.lineTo(x, RULER_HEIGHT);
			ctx.closePath();
			ctx.fill();

			// The label only goes next to the flag when there is room before
			// the next marker; overlapping text is worse than no text.
			const label = marker.label;
			if (label) {
				const available = nextMarkerGap(markers, marker, state.pixelsPerSecond);
				const room = Math.min(available - MARKER_FLAG_WIDTH - 4, MARKER_LABEL_MAX_WIDTH);
				if (room > 16) {
					ctx.fillStyle = COLORS.rulerText;
					ctx.fillText(truncate(ctx, label, room), x + MARKER_FLAG_WIDTH + 3, RULER_HEIGHT - 8);
				}
			}
		}

		ctx.restore();
	}

	private renderPlayhead(ctx: CanvasRenderingContext2D, height: number, state: RenderState): void {
		const x = Math.round(state.currentTime * state.pixelsPerSecond - state.scrollX) + 0.5;

		// Playhead line
		ctx.strokeStyle = COLORS.playhead;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
		ctx.lineWidth = 1;

		// Playhead handle (inverted triangle at ruler)
		ctx.fillStyle = COLORS.playhead;
		ctx.beginPath();
		ctx.moveTo(x - 7, 0);
		ctx.lineTo(x + 7, 0);
		ctx.lineTo(x, 10);
		ctx.closePath();
		ctx.fill();
	}

	private renderSnapLine(ctx: CanvasRenderingContext2D, height: number, state: RenderState): void {
		if (state.snapLine === null) return;
		const x = Math.round(state.snapLine * state.pixelsPerSecond - state.scrollX) + 0.5;

		ctx.strokeStyle = COLORS.snapLine;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(x, RULER_HEIGHT);
		ctx.lineTo(x, height);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	destroy(): void {
		this.stopRenderLoop();
	}

	get rulerHeight(): number {
		return RULER_HEIGHT;
	}

	get trackHeight(): number {
		return TRACK_HEIGHT;
	}

	get trackGap(): number {
		return TRACK_GAP;
	}
}

/** Pixels between a marker and the next one along, or Infinity if it is last. */
function nextMarkerGap(markers: Marker[], marker: Marker, pixelsPerSecond: number): number {
	let nearest = Infinity;
	for (const other of markers) {
		if (other.time > marker.time) nearest = Math.min(nearest, other.time - marker.time);
	}
	return nearest === Infinity ? Infinity : nearest * pixelsPerSecond;
}

/** Clips a label to fit, with an ellipsis, measuring in the canvas's own font. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;

	let cut = text;
	while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
		cut = cut.slice(0, -1);
	}
	return cut + '…';
}
