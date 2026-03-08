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

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  return res.json();
}

export { ApiError };
