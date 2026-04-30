import { useState, useCallback, useEffect, useRef } from 'react';
import { useRepo } from '../contexts/RepoContext';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseFrontmatter } from '../lib/frontmatter';
import {
  ArrowLeft,
  Save,
  Eye,
  Code,
  Trash2,
  Loader,
  Pencil,
  ImagePlus,
} from 'lucide-react';

/**
 * マークダウン本文中の画像パスを正規化する。
 * - `![alt](<path with spaces>)` → `![alt](url-encoded-path)`
 * - `![alt](path with spaces)` → `![alt](url-encoded-path)`
 * これにより react-markdown が正しく img 要素として解析する。
 */
function normalizeImagePaths(md: string): string {
  // <> 記法: ![...](<...>)
  md = md.replace(
    /!\[([^\]]*)\]\(<([^>]+)>\)/g,
    (_, alt, path) => {
      const encoded = path.split('/').map((seg: string) => {
        try { seg = decodeURIComponent(seg); } catch { /* ignore */ }
        return encodeURIComponent(seg);
      }).join('/');
      return `![${alt}](${encoded})`;
    },
  );
  // 通常記法でスペースを含むもの: ![...](path with space)
  // マークダウンの画像はパーレン内にスペースがあると壊れるので修正
  md = md.replace(
    /!\[([^\]]*)\]\(([^)]*\s[^)]*)\)/g,
    (_, alt, path) => {
      if (path.startsWith('http://') || path.startsWith('https://')) return _;
      const encoded = path.split('/').map((seg: string) => {
        try { seg = decodeURIComponent(seg); } catch { /* ignore */ }
        return encodeURIComponent(seg);
      }).join('/');
      return `![${alt}](${encoded})`;
    },
  );
  return md;
}

function resolveImagePath(
  src: string | undefined,
  filePath: string,
): string | null {
  if (!src) return null;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  const dir = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : '';
  let raw: string;
  if (src.startsWith('/')) {
    raw = src.slice(1);
  } else {
    // URL デコードしてから結合（エンコード済みパスの場合も対応）
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch { /* ignore */ }
    raw = dir ? `${dir}/${decoded}` : decoded;
  }
  const parts = raw.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') normalized.pop();
    else if (part !== '.') normalized.push(part);
  }
  return normalized.join('/');
}

function AuthenticatedImage({
  src,
  alt,
  title,
  filePath,
}: {
  src: string | undefined;
  alt: string | undefined;
  title: string | undefined;
  filePath: string;
}) {
  const { client, selectedOwner, selectedRepo, selectedBranch } = useRepo();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const resolvedPath = resolveImagePath(src, filePath);

  useEffect(() => {
    if (!resolvedPath) return;
    if (resolvedPath.startsWith('http://') || resolvedPath.startsWith('https://')) {
      setBlobUrl(resolvedPath);
      return;
    }
    if (!client) return;
    let objectUrl: string | null = null;
    client
      .getImageBase64(selectedOwner, selectedRepo, resolvedPath, selectedBranch)
      .then(({ base64 }: { base64: string }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const ext = resolvedPath.split('.').pop()?.toLowerCase() ?? '';
        const mime =
          ext === 'png' ? 'image/png' :
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
          ext === 'gif' ? 'image/gif' :
          ext === 'webp' ? 'image/webp' :
          'image/png';
        const blob = new Blob([bytes], { type: mime });
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resolvedPath, client, selectedOwner, selectedRepo, selectedBranch]);

  if (!blobUrl) return null;
  return (
    <img
      src={blobUrl}
      alt={alt}
      title={title}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function Editor() {
  const {
    currentFile,
    fileLoading,
    saving,
    dirty,
    saveFile,
    closeFile,
    renameFile,
    deleteCurrentFile,
    setDirty,
    uploadImage,
    selectedOwner,
    selectedRepo,
    selectedBranch,
  } = useRepo();
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (currentFile) {
      setContent(currentFile.content);
      setDirty(false);
      setRenaming(false);
      setMode('preview');
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

  const startRename = useCallback(() => {
    if (!currentFile) return;
    const baseName =
      currentFile.path.split('/').pop()?.replace(/\.md$/, '') || '';
    setRenameValue(baseName);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [currentFile]);

  const commitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (
      !trimmed ||
      trimmed.includes('/') ||
      trimmed === '..' ||
      trimmed === '.'
    ) {
      setRenaming(false);
      return;
    }
    const currentBase =
      currentFile?.path.split('/').pop()?.replace(/\.md$/, '') || '';
    if (trimmed === currentBase) {
      setRenaming(false);
      return;
    }
    if (dirty) {
      await saveFile(contentRef.current);
    }
    setRenaming(false);
    await renameFile(trimmed);
  }, [renameValue, currentFile, dirty, saveFile, renameFile]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      setUploading(true);
      try {
        const imagePath = await uploadImage(file);
        const altText = file.name.replace(/\.[^.]+$/, '');
        const currentDir = currentFile?.path.includes('/')
          ? currentFile.path.slice(0, currentFile.path.lastIndexOf('/'))
          : '';
        const relPath =
          currentDir && imagePath.startsWith(currentDir + '/')
            ? imagePath.slice(currentDir.length + 1)
            : imagePath;
        const encodedRelPath = relPath.split('/').map(encodeURIComponent).join('/');
        const insertion = `\n![${altText}](${encodedRelPath})\n`;
        const newContent = contentRef.current + insertion;
        setContent(newContent);
        setDirty(true);
        setMode('edit');
      } finally {
        setUploading(false);
      }
    },
    [uploadImage, setDirty],
  );

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
        {renaming ? (
          <input
            ref={renameInputRef}
            className="editor-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                cancelRename();
              }
            }}
            onBlur={cancelRename}
            disabled={saving}
          />
        ) : (
          <button
            className="editor-filename-btn"
            onClick={startRename}
            title="Rename"
          >
            <span className="editor-filename">{fileName}</span>
            <Pencil size={12} className="editor-filename-edit-icon" />
          </button>
        )}
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
          className="editor-toolbar-btn"
          onClick={() => imageInputRef.current?.click()}
          disabled={uploading || saving}
          title="Insert image"
        >
          {uploading ? (
            <Loader size={16} className="spin" />
          ) : (
            <ImagePlus size={16} />
          )}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
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
          <div
            className="editor-preview editor-preview--clickable markdown-body"
            onClick={() => setMode('edit')}
            title="クリックして編集"
          >
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt, title }) => (
                  <AuthenticatedImage
                    src={src}
                    alt={alt}
                    title={title}
                    filePath={currentFile!.path}
                  />
                ),
              }}
            >
              {normalizeImagePaths(parseFrontmatter(content).body)}
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
