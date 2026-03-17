import type { Command } from './base-command.js';
import type { TextOverlay, TextShadow, TextOutline, TextAnimation } from '$lib/types/index.js';
import { DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_OUTLINE } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import type { TitleTemplate } from '$lib/utils/title-templates.js';
import { generateId } from '$lib/utils/id.js';

export class AddTextOverlayCommand implements Command {
	readonly type = 'add-text';
	readonly description = 'Add text overlay';
	private overlay: TextOverlay;

	constructor(
		private timeline: TimelineStore,
		private trackId: string,
		private timelineStart: number,
		private duration: number = 5
	) {
		this.overlay = {
			id: generateId(),
			trackId,
			text: 'Text',
			fontFamily: 'Inter',
			fontSize: 48,
			fontWeight: 700,
			color: '#ffffff',
			backgroundColor: 'transparent',
			x: 0.5,
			y: 0.5,
			width: 0.8,
			height: 0.2,
			timelineStart,
			duration,
			opacity: 1,
			alignment: 'center',
			shadow: { ...DEFAULT_TEXT_SHADOW },
			outline: { ...DEFAULT_TEXT_OUTLINE },
			animation: 'none',
			letterSpacing: 0,
			lineHeight: 1.2,
		};
	}

	execute(): void {
		this.timeline.textOverlays = [...this.timeline.textOverlays, this.overlay];
	}

	undo(): void {
		this.timeline.textOverlays = this.timeline.textOverlays.filter((t) => t.id !== this.overlay.id);
	}

	getOverlayId(): string {
		return this.overlay.id;
	}
}

export class RemoveTextOverlayCommand implements Command {
	readonly type = 'remove-text';
	readonly description = 'Remove text overlay';
	private removed: TextOverlay | null = null;

	constructor(
		private timeline: TimelineStore,
		private overlayId: string
	) {}

	execute(): void {
		this.removed = this.timeline.textOverlays.find((t) => t.id === this.overlayId) ?? null;
		this.timeline.textOverlays = this.timeline.textOverlays.filter((t) => t.id !== this.overlayId);
	}

	undo(): void {
		if (this.removed) {
			this.timeline.textOverlays = [...this.timeline.textOverlays, this.removed];
		}
	}
}

export class UpdateTextOverlayCommand implements Command {
	readonly type = 'update-text';
	readonly description = 'Update text overlay';
	private previous: Partial<TextOverlay> = {};

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private updates: Partial<TextOverlay>
	) {}

	execute(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) throw new Error(`Text overlay ${this.overlayId} not found`);

		for (const key of Object.keys(this.updates) as (keyof TextOverlay)[]) {
			(this.previous as any)[key] = (overlay as any)[key];
			(overlay as any)[key] = (this.updates as any)[key];
		}
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}

	undo(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) return;

		for (const key of Object.keys(this.previous) as (keyof TextOverlay)[]) {
			(overlay as any)[key] = (this.previous as any)[key];
		}
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}
}

export class SetTextFontCommand implements Command {
	readonly type = 'set-text-font';
	readonly description = 'Change text font';
	private previousFont: string = '';

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private fontFamily: string
	) {}

	execute(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) throw new Error(`Text overlay ${this.overlayId} not found`);
		this.previousFont = overlay.fontFamily;
		overlay.fontFamily = this.fontFamily;
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}

	undo(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) return;
		overlay.fontFamily = this.previousFont;
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}
}

export class SetTextShadowCommand implements Command {
	readonly type = 'set-text-shadow';
	readonly description = 'Update text shadow';
	private previousShadow: TextShadow | null = null;

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private shadow: TextShadow
	) {}

	execute(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) throw new Error(`Text overlay ${this.overlayId} not found`);
		this.previousShadow = { ...overlay.shadow };
		overlay.shadow = { ...this.shadow };
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}

	undo(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay || !this.previousShadow) return;
		overlay.shadow = { ...this.previousShadow };
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}
}

export class SetTextOutlineCommand implements Command {
	readonly type = 'set-text-outline';
	readonly description = 'Update text outline';
	private previousOutline: TextOutline | null = null;

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private outline: TextOutline
	) {}

	execute(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) throw new Error(`Text overlay ${this.overlayId} not found`);
		this.previousOutline = { ...overlay.outline };
		overlay.outline = { ...this.outline };
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}

	undo(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay || !this.previousOutline) return;
		overlay.outline = { ...this.previousOutline };
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}
}

export class SetTextAnimationCommand implements Command {
	readonly type = 'set-text-animation';
	readonly description = 'Set text animation';
	private previousAnimation: TextAnimation = 'none';

	constructor(
		private timeline: TimelineStore,
		private overlayId: string,
		private animation: TextAnimation
	) {}

	execute(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) throw new Error(`Text overlay ${this.overlayId} not found`);
		this.previousAnimation = overlay.animation;
		overlay.animation = this.animation;
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}

	undo(): void {
		const overlay = this.timeline.textOverlays.find((t) => t.id === this.overlayId);
		if (!overlay) return;
		overlay.animation = this.previousAnimation;
		this.timeline.textOverlays = [...this.timeline.textOverlays];
	}
}

export class AddTitleTemplateCommand implements Command {
	readonly type = 'add-title-template';
	readonly description = 'Add title template';
	private overlays: TextOverlay[] = [];

	constructor(
		private timeline: TimelineStore,
		private template: TitleTemplate,
		private trackId: string,
		private timelineStart: number
	) {
		this.overlays = template.overlays.map((partial) => ({
			id: generateId(),
			trackId,
			text: partial.text ?? 'Text',
			fontFamily: partial.fontFamily ?? 'Inter',
			fontSize: partial.fontSize ?? 48,
			fontWeight: partial.fontWeight ?? 700,
			color: partial.color ?? '#ffffff',
			backgroundColor: partial.backgroundColor ?? 'transparent',
			x: partial.x ?? 0.5,
			y: partial.y ?? 0.5,
			width: partial.width ?? 0.8,
			height: partial.height ?? 0.2,
			timelineStart,
			duration: template.duration,
			opacity: partial.opacity ?? 1,
			alignment: partial.alignment ?? 'center',
			shadow: partial.shadow ? { ...partial.shadow } : { ...DEFAULT_TEXT_SHADOW },
			outline: partial.outline ? { ...partial.outline } : { ...DEFAULT_TEXT_OUTLINE },
			animation: partial.animation ?? 'none',
			letterSpacing: partial.letterSpacing ?? 0,
			lineHeight: partial.lineHeight ?? 1.2,
		}));
	}

	execute(): void {
		this.timeline.textOverlays = [...this.timeline.textOverlays, ...this.overlays];
	}

	undo(): void {
		const ids = new Set(this.overlays.map((o) => o.id));
		this.timeline.textOverlays = this.timeline.textOverlays.filter((t) => !ids.has(t.id));
	}

	getOverlayIds(): string[] {
		return this.overlays.map((o) => o.id);
	}
}
