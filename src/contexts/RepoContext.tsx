import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { buildTree, flattenMdFiles, collectFolderPaths } from '../lib/tree';
import { parseFrontmatter, extractExcerpt } from '../lib/frontmatter';
import type { TreeNode, NoteMeta, FileContent, GitHubRepo } from '../types';

const MAX_PREFETCH = 200;
const PREFETCH_CONCURRENCY = 5;

interface RepoContextValue {
  repos: GitHubRepo[];
  reposLoading: boolean;
  selectedOwner: string;
  selectedRepo: string;
  selectedBranch: string;
  tree: TreeNode[];
  treeLoading: boolean;
  notes: NoteMeta[];
  folderPaths: string[];
  selectedFolderPath: string | null;
  setSelectedFolderPath: (path: string | null) => void;
  currentFile: FileContent | null;
  fileLoading: boolean;
  dirty: boolean;
  saving: boolean;
  prefetching: boolean;
  error: string | null;
  selectRepo: (owner: string, repo: string, branch: string) => void;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  saveFile: (content: string) => Promise<void>;
  createFile: (path: string, content: string) => Promise<void>;
  deleteCurrentFile: () => Promise<void>;
  refreshTree: () => Promise<void>;
  setDirty: (d: boolean) => void;
  clearError: () => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

const REPO_KEY = 'memoapp_selected_repo';

function loadSavedRepo() {
  try {
    const saved = localStorage.getItem(REPO_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function RepoProvider({ children }: { children: ReactNode }) {
  const { client } = useAuth();

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  const saved = loadSavedRepo();
  const [selectedOwner, setSelectedOwner] = useState<string>(
    saved?.owner || '',
  );
  const [selectedRepo, setSelectedRepo] = useState<string>(saved?.repo || '');
  const [selectedBranch, setSelectedBranch] = useState<string>(
    saved?.branch || '',
  );

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [currentFile, setCurrentFile] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentCache, setContentCache] = useState<
    Map<string, { content: string; sha: string }>
  >(new Map());
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(
    null,
  );

  const contentCacheRef = useRef(contentCache);
  contentCacheRef.current = contentCache;

  useEffect(() => {
    if (!client) return;
    setReposLoading(true);
    client
      .listRepos()
      .then(setRepos)
      .catch((e) => setError(e.message))
      .finally(() => setReposLoading(false));
  }, [client]);

  const loadTree = useCallback(async () => {
    if (!client || !selectedOwner || !selectedRepo || !selectedBranch) return;
    setTreeLoading(true);
    setError(null);
    try {
      const data = await client.getTree(
        selectedOwner,
        selectedRepo,
        selectedBranch,
      );
      setTree(buildTree(data.tree));
    } catch (e: any) {
      setError(e.message);
      setTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, [client, selectedOwner, selectedRepo, selectedBranch]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Background prefetch of .md file contents for card excerpts
  useEffect(() => {
    if (!client || !selectedOwner || !selectedRepo || !selectedBranch) return;
    if (tree.length === 0) return;

    let cancelled = false;
    const allFiles = flattenMdFiles(tree);
    const toFetch = allFiles
      .filter((f) => !contentCacheRef.current.has(f.path))
      .slice(0, MAX_PREFETCH);

    if (toFetch.length === 0) return;

    setPrefetching(true);
    let remaining = toFetch.length;
    let idx = 0;

    async function worker() {
      while (!cancelled) {
        const fileIdx = idx++;
        if (fileIdx >= toFetch.length) break;
        const file = toFetch[fileIdx];
        try {
          const data = await client!.getFileContent(
            selectedOwner,
            selectedRepo,
            file.path,
            selectedBranch,
          );
          if (!cancelled) {
            setContentCache((prev) =>
              new Map(prev).set(file.path, {
                content: data.decodedContent,
                sha: data.sha,
              }),
            );
          }
        } catch {
          // skip individual errors
        }
        remaining--;
        if (remaining <= 0 && !cancelled) setPrefetching(false);
      }
    }

    const workers = Array.from(
      { length: Math.min(PREFETCH_CONCURRENCY, toFetch.length) },
      () => worker(),
    );
    Promise.all(workers).then(() => {
      if (!cancelled) setPrefetching(false);
    });

    return () => {
      cancelled = true;
      setPrefetching(false);
    };
  }, [tree, client, selectedOwner, selectedRepo, selectedBranch]);

  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);

  const notes = useMemo<NoteMeta[]>(() => {
    return flattenMdFiles(tree).map((node) => {
      const cached = contentCache.get(node.path);
      let title = node.name.replace(/\.md$/, '');
      let tags: string[] = [];
      let excerpt = '';

      if (cached) {
        const { data } = parseFrontmatter(cached.content);
        if (typeof data.title === 'string') title = data.title;
        if (Array.isArray(data.tags)) tags = data.tags;
        excerpt = extractExcerpt(cached.content);
      }

      return { title, tags, excerpt, path: node.path, sha: node.sha };
    });
  }, [tree, contentCache]);

  const selectRepo = useCallback(
    (owner: string, repo: string, branch: string) => {
      setSelectedOwner(owner);
      setSelectedRepo(repo);
      setSelectedBranch(branch);
      setCurrentFile(null);
      setDirty(false);
      setContentCache(new Map());
      setSelectedFolderPath(null);
      localStorage.setItem(
        REPO_KEY,
        JSON.stringify({ owner, repo, branch }),
      );
    },
    [],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (!client || !selectedOwner || !selectedRepo) return;
      setFileLoading(true);
      setError(null);
      try {
        const data = await client.getFileContent(
          selectedOwner,
          selectedRepo,
          path,
          selectedBranch,
        );
        const file: FileContent = {
          path,
          content: data.decodedContent,
          sha: data.sha,
        };
        setCurrentFile(file);
        setDirty(false);
        setContentCache(
          (prev) =>
            new Map(prev).set(path, {
              content: data.decodedContent,
              sha: data.sha,
            }),
        );
      } catch (e: any) {
        setError(e.message);
      } finally {
        setFileLoading(false);
      }
    },
    [client, selectedOwner, selectedRepo, selectedBranch],
  );

  const closeFile = useCallback(() => {
    setCurrentFile(null);
    setDirty(false);
  }, []);

  const saveFile = useCallback(
    async (content: string) => {
      if (!client || !currentFile) return;
      setSaving(true);
      setError(null);
      try {
        const res = await client.putFile(
          selectedOwner,
          selectedRepo,
          currentFile.path,
          content,
          `Update ${currentFile.path}`,
          currentFile.sha,
          selectedBranch,
        );
        const newSha = res.content.sha;
        setCurrentFile({ ...currentFile, content, sha: newSha });
        setDirty(false);
        setContentCache(
          (prev) =>
            new Map(prev).set(currentFile.path, { content, sha: newSha }),
        );
        setTree((prev) => updateTreeSha(prev, currentFile.path, newSha));
      } catch (e: any) {
        if (e.status === 409) {
          setError(
            'Conflict: the file was modified elsewhere. Please refresh and try again.',
          );
        } else {
          setError(e.message);
        }
      } finally {
        setSaving(false);
      }
    },
    [client, currentFile, selectedOwner, selectedRepo, selectedBranch],
  );

  const createFile = useCallback(
    async (path: string, content: string) => {
      if (!client) return;
      setSaving(true);
      setError(null);
      try {
        await client.putFile(
          selectedOwner,
          selectedRepo,
          path,
          content,
          `Create ${path}`,
          undefined,
          selectedBranch,
        );
        await loadTree();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    },
    [client, selectedOwner, selectedRepo, selectedBranch, loadTree],
  );

  const deleteCurrentFile = useCallback(async () => {
    if (!client || !currentFile) return;
    setSaving(true);
    setError(null);
    try {
      await client.deleteFile(
        selectedOwner,
        selectedRepo,
        currentFile.path,
        currentFile.sha,
        `Delete ${currentFile.path}`,
        selectedBranch,
      );
      setCurrentFile(null);
      setDirty(false);
      setContentCache((prev) => {
        const next = new Map(prev);
        next.delete(currentFile.path);
        return next;
      });
      await loadTree();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [
    client,
    currentFile,
    selectedOwner,
    selectedRepo,
    selectedBranch,
    loadTree,
  ]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <RepoContext.Provider
      value={{
        repos,
        reposLoading,
        selectedOwner,
        selectedRepo,
        selectedBranch,
        tree,
        treeLoading,
        notes,
        folderPaths,
        selectedFolderPath,
        setSelectedFolderPath,
        currentFile,
        fileLoading,
        dirty,
        saving,
        prefetching,
        error,
        selectRepo,
        openFile,
        closeFile,
        saveFile,
        createFile,
        deleteCurrentFile,
        refreshTree: loadTree,
        setDirty,
        clearError,
      }}
    >
      {children}
    </RepoContext.Provider>
  );
}

function updateTreeSha(
  nodes: TreeNode[],
  path: string,
  sha: string,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return { ...n, sha };
    if (n.children)
      return { ...n, children: updateTreeSha(n.children, path, sha) };
    return n;
  });
}

export function useRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used within RepoProvider');
  return ctx;
}
