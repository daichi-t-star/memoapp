import { useState, useMemo } from 'react';
import { useRepo } from '../contexts/RepoContext';
import { NoteCard } from './NoteCard';
import { LayoutGrid, Loader } from 'lucide-react';

export function CardView() {
  const {
    notes,
    selectedRepo,
    treeLoading,
    openFile,
    selectedFolderPath,
    prefetching,
  } = useRepo();
  const [search, setSearch] = useState('');

  if (!selectedRepo) {
    return (
      <div className="card-view-empty">
        <LayoutGrid size={48} strokeWidth={1} />
        <h2>Welcome to MemoApp</h2>
        <p>Select a repository from the sidebar to get started</p>
      </div>
    );
  }

  if (treeLoading) {
    return (
      <div className="card-view-empty">
        <Loader size={32} className="spin" />
        <p>Loading notes...</p>
      </div>
    );
  }

  const folderFiltered = selectedFolderPath
    ? notes.filter((n) => n.path.startsWith(selectedFolderPath + '/'))
    : notes;

  const q = search.toLowerCase();
  const filtered = q
    ? folderFiltered.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)) ||
          n.path.toLowerCase().includes(q) ||
          n.excerpt.toLowerCase().includes(q),
      )
    : folderFiltered;

  return (
    <div className="card-view">
      <div className="card-view-header">
        <input
          type="search"
          placeholder="Search notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="card-view-search"
        />
        <span className="card-view-count">
          {filtered.length} notes
          {prefetching && ' (loading...)'}
        </span>
      </div>
      {selectedFolderPath && (
        <div className="card-view-folder-label">{selectedFolderPath}/</div>
      )}
      {filtered.length === 0 ? (
        <div className="card-view-empty">
          <p>
            {search
              ? 'No matching notes'
              : 'No markdown files in this repository'}
          </p>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((note) => (
            <NoteCard
              key={note.path}
              note={note}
              onClick={() => openFile(note.path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
