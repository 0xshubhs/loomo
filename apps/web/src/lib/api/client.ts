const API_BASE = '';  // Empty in dev (Vite proxy handles /api)

class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error || `API error ${status}`);
  }
}

function getAuthHeaders(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) return false;
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      localStorage.setItem('auth_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      return true;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });

  // Auto-refresh on 401
  if (res.status === 401 && typeof localStorage !== 'undefined') {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...options?.headers,
        },
      });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  return res.json();
}

export { ApiError };
