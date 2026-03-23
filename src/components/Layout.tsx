import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { CardView } from './CardView';
import { Editor } from './Editor';
import { useRepo } from '../contexts/RepoContext';
import { useAuth } from '../contexts/AuthContext';
import { Menu, X, LogOut } from 'lucide-react';

export function Layout() {
  const { user, logout } = useAuth();
  const { currentFile, selectedRepo, error, clearError } = useRepo();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="layout">
      <header className="header">
        <button
          className="header-menu-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h1 className="header-title">MemoApp</h1>
        {selectedRepo && (
          <span className="header-repo">{selectedRepo}</span>
        )}
        <div className="header-spacer" />
        {user && (
          <div className="header-user">
            <img
              src={user.avatar_url}
              alt={user.login}
              className="header-avatar"
            />
            <span className="header-username">{user.login}</span>
            <button className="header-logout" onClick={logout} title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={clearError}>&times;</button>
        </div>
      )}

      <div className="layout-body">
        <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </aside>
        <div
          className="sidebar-overlay"
          data-open={sidebarOpen}
          onClick={() => setSidebarOpen(false)}
        />
        <main className="main-content">
          {currentFile ? <Editor /> : <CardView />}
        </main>
      </div>
    </div>
  );
}
