import { useState, useCallback, useEffect, useRef } from 'react';
import { useRepo } from '../contexts/RepoContext';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseFrontmatter } from '../lib/frontmatter';
import { ArrowLeft, Save, Eye, Code, Trash2, Loader } from 'lucide-react';

export function Editor() {
  const {
    currentFile,
    fileLoading,
    saving,
    dirty,
    saveFile,
    closeFile,
    deleteCurrentFile,
    setDirty,
  } = useRepo();
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (currentFile) {
      setContent(currentFile.content);
      setDirty(false);
    }
  }, [currentFile?.path, currentFile?.sha]);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      setDirty(true);
    },
    [setDirty],
  );

  const handleSave = useCallback(() => {
    saveFile(contentRef.current);
  }, [saveFile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, handleSave]);

  if (fileLoading) {
    return (
      <div className="editor-loading">
        <Loader size={32} className="spin" />
      </div>
    );
  }

  if (!currentFile) return null;

  const fileName =
    currentFile.path.split('/').pop()?.replace(/\.md$/, '') ||
    currentFile.path;

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button className="editor-toolbar-btn" onClick={closeFile} title="Back">
          <ArrowLeft size={18} />
        </button>
        <span className="editor-filename">{fileName}</span>
        {dirty && <span className="editor-dirty">&bull;</span>}
        <div className="editor-toolbar-spacer" />
        <div className="editor-mode-toggle">
          <button
            className={`editor-mode-btn ${mode === 'edit' ? 'editor-mode-btn--active' : ''}`}
            onClick={() => setMode('edit')}
          >
            <Code size={16} />
          </button>
          <button
            className={`editor-mode-btn ${mode === 'preview' ? 'editor-mode-btn--active' : ''}`}
            onClick={() => setMode('preview')}
          >
            <Eye size={16} />
          </button>
        </div>
        <button
          className="editor-toolbar-btn editor-save-btn"
          onClick={handleSave}
          disabled={!dirty || saving}
          title="Save"
        >
          {saving ? (
            <Loader size={16} className="spin" />
          ) : (
            <Save size={16} />
          )}
          <span>Save</span>
        </button>
        <button
          className="editor-toolbar-btn editor-delete-btn"
          onClick={() => setShowDeleteConfirm(true)}
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="editor-content">
        {mode === 'edit' ? (
          <CodeMirror
            value={content}
            onChange={handleChange}
            extensions={[markdown()]}
            className="editor-codemirror"
            height="100%"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
            }}
          />
        ) : (
          <div className="editor-preview markdown-body">
            <Markdown remarkPlugins={[remarkGfm]}>
              {parseFrontmatter(content).body}
            </Markdown>
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <div
          className="dialog-overlay"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete note</h3>
            <p>Are you sure you want to delete &ldquo;{fileName}&rdquo;?</p>
            <div className="dialog-actions">
              <button
                className="btn btn--secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={() => {
                  deleteCurrentFile();
                  setShowDeleteConfirm(false);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
