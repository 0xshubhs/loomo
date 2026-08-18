import { createAnnotationToolState, type AnnotationToolState } from '$lib/types/annotations.js';
export class UIStore {
	// Drawing tools, shared between the annotation panel (which arms a tool)
	// and the preview layer (which is inert until one is armed).
	annotationTools = $state<AnnotationToolState>(createAnnotationToolState());
	selectedAnnotationId = $state<string | null>(null);

	timelineZoom = $state<number>(100);
	timelineScrollX = $state<number>(0);
	timelineScrollY = $state<number>(0);
	panelSizes = $state<{ left: number; bottom: number }>({ left: 260, bottom: 300 });
	activePanel = $state<'media' | 'properties' | null>('media');
	showExportDialog = $state<boolean>(false);
	showTextEditor = $state<boolean>(false);
	snapEnabled = $state<boolean>(true);
	magneticSnap = $state<boolean>(true);
	activeTool = $state<'select' | 'razor' | 'hand'>('select');
	showCaptionDialog = $state<boolean>(false);
	showSilenceRemoval = $state<boolean>(false);
	showVoiceoverDialog = $state<boolean>(false);
	previewFillMode = $state<'fit' | 'fill'>('fit');
	previewFullscreen = $state<boolean>(false);
	sidebarCollapsed = $state<boolean>(false);
	timelineCollapsed = $state<boolean>(false);

	get pixelsPerSecond(): number {
		return this.timelineZoom;
	}

	zoomIn(): void {
		this.timelineZoom = Math.min(500, this.timelineZoom * 1.2);
	}

	zoomOut(): void {
		this.timelineZoom = Math.max(10, this.timelineZoom / 1.2);
	}

	zoomToFit(duration: number, viewWidth: number): void {
		if (duration <= 0) return;
		this.timelineZoom = (viewWidth - 40) / duration;
		this.timelineScrollX = 0;
	}
}
