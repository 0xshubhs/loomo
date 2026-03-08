export interface VideoItem {
  id: string;
  title: string;
  description: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  durationMs: number | null;
  thumbnailUrl: string | null;
  gifUrl: string | null;
  hlsUrl: string | null;
  shareMode: string;
  shareUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationState {
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}
