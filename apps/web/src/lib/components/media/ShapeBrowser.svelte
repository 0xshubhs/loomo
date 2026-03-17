<script lang="ts">
	import { SHAPES, getCategories, type ShapeCategory } from '$lib/utils/shapes.js';
	import { getTimeline, getCommands, getPlayback, getSelection } from '$lib/state/context.js';
	import { AddShapeOverlayCommand } from '$lib/commands/shape-commands.js';

	const timeline = getTimeline();
	const commands = getCommands();
	const playback = getPlayback();
	const selection = getSelection();

	let searchQuery = $state('');
	let activeCategory = $state<ShapeCategory | 'All'>('All');

	const categories = getCategories();

	let filteredShapes = $derived.by(() => {
		let shapes = SHAPES;
		if (activeCategory !== 'All') {
			shapes = shapes.filter((s) => s.category === activeCategory);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			shapes = shapes.filter(
				(s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
			);
		}
		return shapes;
	});

	function handleAddShape(shapeId: string) {
		const cmd = new AddShapeOverlayCommand(
			timeline,
			shapeId,
			playback.currentTime
		);
		commands.execute(cmd);
		selection.selectShape(cmd.getOverlayId());
	}
</script>

<div class="shape-browser">
	<div class="browser-header">
		<h3>Shapes</h3>
		<span class="count">{filteredShapes.length}</span>
	</div>

	<div class="search-bar">
		<input
			type="text"
			placeholder="Search shapes..."
			bind:value={searchQuery}
			class="search-input"
		/>
	</div>

	<div class="category-tabs">
		<button
			class="tab-pill"
			class:active={activeCategory === 'All'}
			onclick={() => (activeCategory = 'All')}
		>
			All
		</button>
		{#each categories as cat}
			<button
				class="tab-pill"
				class:active={activeCategory === cat}
				onclick={() => (activeCategory = cat)}
			>
				{cat}
			</button>
		{/each}
	</div>

	<div class="shape-grid">
		{#each filteredShapes as shape (shape.id)}
			<button
				class="shape-card"
				title={shape.name}
				onclick={() => handleAddShape(shape.id)}
			>
				<svg viewBox={shape.viewBox} class="shape-preview">
					<path d={shape.path} fill="currentColor" />
				</svg>
				<span class="shape-name">{shape.name}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.shape-browser {
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

	.search-bar {
		padding: 8px 12px 4px;
	}

	.search-input {
		width: 100%;
		height: 28px;
		font-size: 11px;
		color: var(--text-secondary);
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0 8px;
		outline: none;
		transition: border-color 0.15s;
	}

	.search-input:focus {
		border-color: var(--accent);
	}

	.search-input::placeholder {
		color: var(--text-muted);
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

	.shape-grid {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		align-content: start;
	}

	.shape-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 4px 6px;
		background: var(--bg-hover);
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.shape-card:hover {
		background: var(--bg-active);
		border-color: var(--border-primary);
	}

	.shape-card:active {
		border-color: var(--accent);
	}

	.shape-preview {
		width: 32px;
		height: 32px;
		color: var(--text-secondary);
	}

	.shape-name {
		font-size: 9px;
		color: var(--text-tertiary);
		text-align: center;
		line-height: 1.2;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
