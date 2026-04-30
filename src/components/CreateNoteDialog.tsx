import { useState, type FormEvent } from 'react';
import { useRepo } from '../contexts/RepoContext';
import { X } from 'lucide-react';

interface CreateNoteDialogProps {
  onClose: () => void;
}

export function CreateNoteDialog({ onClose }: CreateNoteDialogProps) {
  const { createFile, saving, folderPaths, selectedFolderPath } = useRepo();
  const [folder, setFolder] = useState(selectedFolderPath ?? '');
  const [fileName, setFileName] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const base = fileName.trim().replace(/\.md$/, '');
    if (!base || base.includes('/') || base === '..' || base === '.') return;
    const filePath = folder ? `${folder}/${base}.md` : `${base}.md`;
    const content = `---\ntitle: ${base}\ncreated: ${new Date().toISOString()}\ntags: []\n---\n\n# ${base}\n\n`;
    try {
      await createFile(filePath, content);
      onClose();
    } catch {
      // エラーは context.error に表示される
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>New Note</h3>
          <button className="dialog-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="note-folder">Folder</label>
          <select
            id="note-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="dialog-select"
          >
            <option value="">/ (root)</option>
            {folderPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label htmlFor="note-filename">File name</label>
          <input
            id="note-filename"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="my-note"
            autoFocus
            required
          />
          <div className="dialog-filename-hint">.md is added automatically</div>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || !fileName.trim()}
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
