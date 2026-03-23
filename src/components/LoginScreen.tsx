import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { KeyRound } from 'lucide-react';

export function LoginScreen() {
  const { login, loading, error } = useAuth();
  const [token, setToken] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (token.trim()) login(token.trim());
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <KeyRound size={40} />
        </div>
        <h1>MemoApp</h1>
        <p className="login-description">
          GitHub リポジトリで Markdown メモを管理
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="token">GitHub Personal Access Token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
            autoFocus
            disabled={loading}
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading || !token.trim()}>
            {loading ? 'Connecting...' : 'Connect to GitHub'}
          </button>
        </form>
        <div className="login-help">
          <a
            href="https://github.com/settings/tokens?type=beta"
            target="_blank"
            rel="noreferrer"
          >
            Create a fine-grained token
          </a>
          <p>Contents read/write permission required</p>
        </div>
      </div>
    </div>
  );
}
