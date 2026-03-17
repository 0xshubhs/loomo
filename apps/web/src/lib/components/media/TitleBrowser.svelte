<script lang="ts">
	import {
		TITLE_TEMPLATES,
		TITLE_CATEGORIES,
		CATEGORY_COLORS,
		type TitleCategory,
		type TitleTemplate,
	} from '$lib/utils/title-templates.js';
	import { getTimeline, getCommands, getPlayback, getSelection } from '$lib/state/context.js';
	import { AddTitleTemplateCommand } from '$lib/commands/text-commands.js';

	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();
	const selection = getSelection();

	let activeCategory = $state<TitleCategory | 'all'>('all');

	let filteredTemplates = $derived.by(() => {
		if (activeCategory === 'all') return TITLE_TEMPLATES;
		return TITLE_TEMPLATES.filter((t) => t.category === activeCategory);
	});

	function handleAddTemplate(template: TitleTemplate) {
		const trackId = timeline.tracks[0]?.id ?? 'default';
		const cmd = new AddTitleTemplateCommand(
			timeline,
			template,
			trackId,
			playback.currentTime
		);
		commands.execute(cmd);
		const ids = cmd.getOverlayIds();
		if (ids.length > 0) {
			selection.selectText(ids[0]);
		}
	}

	function categoryLabel(cat: TitleCategory): string {
		switch (cat) {
			case 'basic': return 'Basic';
			case 'lower-third': return 'Lower Third';
			case 'animated': return 'Animated';
			case 'social': return 'Social';
			default: return cat;
		}
	}
</script>

<div class="title-browser">
	<div class="browser-header">
		<h3>Titles</h3>
		<span class="count">{filteredTemplates.length}</span>
	</div>

	<div class="category-tabs">
		{#each TITLE_CATEGORIES as cat}
			<button
				class="tab-pill"
				class:active={activeCategory === cat.value}
				onclick={() => (activeCategory = cat.value)}
			>
				{cat.label}
			</button>
		{/each}
	</div>

	<div class="title-grid">
		{#each filteredTemplates as template (template.id)}
			{@const colors = CATEGORY_COLORS[template.category]}
			<button
				class="title-card"
				title={template.preview}
				onclick={() => handleAddTemplate(template)}
			>
				<div class="title-preview" style="background: {colors.bg};">
					<div class="preview-accent" style="background: {colors.accent};"></div>
					<span class="preview-text">{template.overlays[0]?.text ?? 'Title'}</span>
					{#if template.overlays.length > 1}
						<span class="preview-subtitle">{template.overlays[1]?.text ?? ''}</span>
					{/if}
				</div>
				<div class="title-info">
					<span class="title-name">{template.name}</span>
					<span class="title-category">{categoryLabel(template.category)}</span>
				</div>
			</button>
		{/each}
	</div>
</div>

<style>
	.title-browser {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.browser-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border-primary);
	}

	.browser-header h3 {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.count {
		font-size: 10px;
		color: var(--text-muted);
		background: var(--bg-surface);
		padding: 1px 6px;
		border-radius: 8px;
	}

	.category-tabs {
		display: flex;
		gap: 4px;
		padding: 8px 12px;
		overflow-x: auto;
		flex-shrink: 0;
	}

	.category-tabs::-webkit-scrollbar {
		display: none;
	}

	.tab-pill {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--text-tertiary);
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 12px;
		padding: 3px 10px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.tab-pill:hover {
		color: var(--text-secondary);
		background: var(--bg-active);
	}

	.tab-pill.active {
		color: var(--accent);
		border-color: var(--accent);
		background: var(--bg-active);
	}

	.title-grid {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 6px;
		align-content: start;
	}

	.title-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		overflow: hidden;
		transition: border-color 0.15s, background 0.15s;
		text-align: left;
		padding: 0;
	}

	.title-card:hover {
		background: var(--bg-active);
		border-color: var(--border-primary);
	}

	.title-card:active {
		border-color: var(--accent);
	}

	.title-preview {
		position: relative;
		height: 60px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		overflow: hidden;
		border-radius: 5px 5px 0 0;
	}

	.preview-accent {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 3px;
	}

	.preview-text {
		font-size: 11px;
		font-weight: 700;
		color: #ffffff;
		text-align: center;
		line-height: 1.2;
		max-width: 90%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preview-subtitle {
		font-size: 8px;
		font-weight: 400;
		color: rgba(255, 255, 255, 0.7);
		text-align: center;
		max-width: 90%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title-info {
		padding: 4px 6px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.title-name {
		font-size: 10px;
		font-weight: 600;
		color: var(--text-secondary);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title-category {
		font-size: 8px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
</style>
