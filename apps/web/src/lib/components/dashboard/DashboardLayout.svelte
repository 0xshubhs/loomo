<script lang="ts">
	import { getDashboard } from '$lib/state/context.js';

	const dashboard = getDashboard();
</script>

<div class="dashboard">
	<header class="header">
		<div class="header-left">
			<h1 class="logo">DITTOO</h1>
		</div>
		<div class="header-center">
			<input
				type="text"
				class="search-input"
				placeholder="Search recordings..."
				bind:value={dashboard.searchQuery}
			/>
		</div>
		<div class="header-right">
			<a href="/record" class="new-recording-btn">
				<span class="rec-dot"></span>
				New Recording
			</a>
		</div>
	</header>

	<main class="content">
		{#if dashboard.filteredVideos.length === 0}
			<div class="empty-state">
				<h2>No recordings yet</h2>
				<p>Start by creating your first recording</p>
				<a href="/record" class="cta-btn">Start Recording</a>
			</div>
		{:else}
			<div class="video-grid">
				{#each dashboard.filteredVideos as video (video.id)}
					<a href="/share/{video.id}" class="video-card">
						<div class="thumbnail">
							{#if video.thumbnailUrl}
								<img src={video.thumbnailUrl} alt={video.title} />
							{:else}
								<div class="placeholder-thumb">
									{#if video.status === 'processing'}
										<span>Processing...</span>
									{:else}
										<span>No thumbnail</span>
									{/if}
								</div>
							{/if}
							{#if video.durationMs}
								<span class="duration">{Math.floor(video.durationMs / 60000)}:{((video.durationMs / 1000) % 60).toFixed(0).padStart(2, '0')}</span>
							{/if}
						</div>
						<div class="card-info">
							<h3 class="card-title">{video.title}</h3>
							<span class="card-date">{video.createdAt}</span>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	.dashboard {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-primary);
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 32px;
		border-bottom: 1px solid var(--border-primary);
	}
	.logo {
		font-size: 18px;
		font-weight: 700;
		letter-spacing: 2px;
	}
	.search-input {
		width: 320px;
		padding: 8px 16px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: 999px;
		color: var(--text-primary);
		font-size: 13px;
	}
	.search-input:focus { border-color: var(--border-focus); outline: none; }
	.search-input::placeholder { color: var(--text-muted); }
	.new-recording-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 20px;
		background: #ff3333;
		border-radius: var(--radius-md);
		color: white;
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		transition: var(--transition-fast);
	}
	.new-recording-btn:hover { background: #ff5555; }
	.rec-dot {
		width: 8px;
		height: 8px;
		background: white;
		border-radius: 50%;
	}
	.content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 32px;
	}
	.empty-state {
		text-align: center;
		padding: 80px 0;
	}
	.empty-state h2 { font-size: 20px; margin-bottom: 8px; }
	.empty-state p { color: var(--text-secondary); margin-bottom: 24px; }
	.cta-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 28px;
		background: #ff3333;
		border-radius: var(--radius-md);
		color: white;
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
	}
	.cta-btn:hover { background: #ff5555; }
	.video-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 20px;
	}
	.video-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-lg);
		overflow: hidden;
		cursor: pointer;
		transition: var(--transition-fast);
		text-decoration: none;
		color: inherit;
	}
	.video-card:hover { border-color: var(--border-secondary); }
	.thumbnail {
		aspect-ratio: 16/9;
		background: var(--bg-tertiary);
		position: relative;
		overflow: hidden;
	}
	.thumbnail img { width: 100%; height: 100%; object-fit: cover; }
	.placeholder-thumb {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: var(--text-muted);
	}
	.duration {
		position: absolute;
		bottom: 6px;
		right: 6px;
		background: rgba(0, 0, 0, 0.8);
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 11px;
		font-family: var(--font-mono);
		color: white;
	}
	.card-info { padding: 12px; }
	.card-title {
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 4px;
	}
	.card-date {
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
