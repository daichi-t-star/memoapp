import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { GitHubClient } from '../lib/github';
import type { GitHubUser } from '../types';

interface AuthContextValue {
  token: string | null;
  user: GitHubUser | null;
  client: GitHubClient | null;
  loading: boolean;
  error: string | null;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'memoapp_gh_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [client, setClient] = useState<GitHubClient | null>(null);
  const [loading, setLoading] = useState(!!localStorage.getItem(TOKEN_KEY));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setClient(null);
      setUser(null);
      setLoading(false);
      return;
    }
    const c = new GitHubClient(token);
    setClient(c);
    setLoading(true);
    c.getUser()
      .then((u) => {
        setUser(u);
        setError(null);
      })
      .catch(() => {
        setToken(null);
        setClient(null);
        localStorage.removeItem(TOKEN_KEY);
        setError('Invalid token');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback((t: string) => {
    setError(null);
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setClient(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, user, client, loading, error, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
