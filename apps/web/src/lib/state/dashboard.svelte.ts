import type { VideoItem, PaginationState } from '$lib/types/dashboard.js';

export class DashboardStore {
  videos = $state<VideoItem[]>([]);
  searchQuery = $state<string>('');
  loading = $state<boolean>(false);
  sortBy = $state<'newest' | 'oldest' | 'name'>('newest');
  pagination = $state<PaginationState>({ page: 1, perPage: 20, total: 0, hasMore: false });

  get filteredVideos(): VideoItem[] {
    let filtered = this.videos;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(v => v.title.toLowerCase().includes(q));
    }
    return filtered;
  }

  setVideos(videos: VideoItem[], pagination: PaginationState) {
    this.videos = videos;
    this.pagination = pagination;
  }

  addVideo(video: VideoItem) {
    this.videos = [video, ...this.videos];
    this.pagination.total++;
  }

  removeVideo(id: string) {
    this.videos = this.videos.filter(v => v.id !== id);
    this.pagination.total--;
  }

  updateVideo(id: string, updates: Partial<VideoItem>) {
    this.videos = this.videos.map(v => v.id === id ? { ...v, ...updates } : v);
  }
}
