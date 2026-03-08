import { apiFetch } from './client.js';

export interface AuthResponse {
  user: { id: string; email: string; name: string; avatar_url: string | null; created_at: string };
  access_token: string;
  refresh_token: string;
}

export async function signup(email: string, password: string, name: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function refreshToken(token: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: token }),
  });
}
