import type { User } from '$lib/types/auth.js';

export class AuthStore {
  user = $state<User | null>(null);
  token = $state<string | null>(null);
  refreshToken = $state<string | null>(null);
  loading = $state<boolean>(true);
  error = $state<string | null>(null);

  get isAuthenticated() { return this.user !== null && this.token !== null; }

  setSession(user: User, accessToken: string, refreshToken: string) {
    this.user = user;
    this.token = accessToken;
    this.refreshToken = refreshToken;
    this.loading = false;
    this.error = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('auth_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
    }
  }

  logout() {
    this.user = null;
    this.token = null;
    this.refreshToken = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
    }
  }

  loadSession() {
    if (typeof localStorage === 'undefined') {
      this.loading = false;
      return;
    }
    try {
      const token = localStorage.getItem('auth_token');
      const refresh = localStorage.getItem('refresh_token');
      const userStr = localStorage.getItem('user');
      if (token && userStr) {
        this.token = token;
        this.refreshToken = refresh;
        this.user = JSON.parse(userStr);
      }
    } catch { /* ignore */ }
    this.loading = false;
  }
}
