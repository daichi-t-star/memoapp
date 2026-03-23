import { useState } from 'react';
import { RepoSelector } from './RepoSelector';
import { TreeView } from './TreeView';
import { CreateNoteDialog } from './CreateNoteDialog';
import { useRepo } from '../contexts/RepoContext';
import { Plus, RefreshCw, List } from 'lucide-react';

interface SidebarProps {
  onNavigate: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const {
    selectedRepo,
    treeLoading,
    refreshTree,
    selectedFolderPath,
    setSelectedFolderPath,
  } = useRepo();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="sidebar-inner">
      <RepoSelector />
      {selectedRepo && (
        <>
          <div className="sidebar-actions">
            <button
              className="sidebar-action-btn"
              onClick={() => setShowCreate(true)}
              title="New note"
            >
              <Plus size={16} /> New
            </button>
            <button
              className="sidebar-action-btn"
              onClick={refreshTree}
              disabled={treeLoading}
              title="Refresh"
            >
              <RefreshCw size={16} className={treeLoading ? 'spin' : ''} />
            </button>
            {selectedFolderPath && (
              <button
                className="sidebar-action-btn sidebar-all-btn"
                onClick={() => setSelectedFolderPath(null)}
                title="Show all notes"
              >
                <List size={16} /> All
              </button>
            )}
          </div>
          <TreeView onSelect={onNavigate} />
        </>
      )}
      {showCreate && (
        <CreateNoteDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
