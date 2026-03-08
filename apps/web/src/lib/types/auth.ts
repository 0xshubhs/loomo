export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshToken: string;
}
