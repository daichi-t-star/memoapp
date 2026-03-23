import type { NoteMeta } from '../types';
import { FileText } from 'lucide-react';

interface NoteCardProps {
  note: NoteMeta;
  onClick: () => void;
}

export function NoteCard({ note, onClick }: NoteCardProps) {
  return (
    <button className="note-card" onClick={onClick} type="button">
      <div className="note-card-header">
        <FileText size={16} className="note-card-icon" />
        <h3 className="note-card-title">{note.title}</h3>
      </div>
      {note.excerpt && <p className="note-card-excerpt">{note.excerpt}</p>}
    </button>
  );
}
