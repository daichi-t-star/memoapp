import { useState, useMemo, useCallback } from 'react';
import { useRepo } from '../contexts/RepoContext';
import type { TreeNode } from '../types';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Loader,
} from 'lucide-react';

interface TreeViewProps {
  onSelect?: () => void;
}

export function TreeView({ onSelect }: TreeViewProps) {
  const {
    tree,
    treeLoading,
    currentFile,
    openFile,
    selectedFolderPath,
    setSelectedFolderPath,
    dateCache,
  } = useRepo();

  const getNewestDate = useCallback(
    (node: TreeNode): string | null => {
      if (node.type === 'file') return dateCache.get(node.path) ?? null;
      if (!node.children) return null;
      let newest: string | null = null;
      for (const child of node.children) {
        const d = getNewestDate(child);
        if (d && (!newest || d > newest)) newest = d;
      }
      return newest;
    },
    [dateCache],
  );

  const sortedTree = useMemo(() => {
    function sortNodes(nodes: TreeNode[]): TreeNode[] {
      const sorted = nodes.map((n) =>
        n.children ? { ...n, children: sortNodes(n.children) } : n,
      );
      sorted.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        const da = getNewestDate(a);
        const db = getNewestDate(b);
        if (!da && !db) return a.name.localeCompare(b.name);
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      });
      return sorted;
    }
    return sortNodes(tree);
  }, [tree, getNewestDate]);

  if (treeLoading) {
    return (
      <div className="tree-loading">
        <Loader size={18} className="spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (tree.length === 0) {
    return <div className="tree-empty">No markdown files found</div>;
  }

  return (
    <div className="tree-view">
      {sortedTree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          currentPath={currentFile?.path}
          selectedFolderPath={selectedFolderPath}
          onOpen={(path) => {
            openFile(path);
            onSelect?.();
          }}
          onSelectFolder={(path) => {
            setSelectedFolderPath(
              path === selectedFolderPath ? null : path,
            );
          }}
        />
      ))}
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  currentPath?: string;
  selectedFolderPath: string | null;
  onOpen: (path: string) => void;
  onSelectFolder: (path: string) => void;
}

function TreeItem({
  node,
  depth,
  currentPath,
  selectedFolderPath,
  onOpen,
  onSelectFolder,
}: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);

  const isActive = node.path === currentPath;
  const isFolderSelected =
    node.type === 'dir' && node.path === selectedFolderPath;

  const handleRowClick = () => {
    if (node.type === 'dir') {
      onSelectFolder(node.path);
      if (!expanded) setExpanded(true);
    } else {
      onOpen(node.path);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div>
      <div
        className={`tree-item ${isActive ? 'tree-item--active' : ''} ${isFolderSelected ? 'tree-item--folder-selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={handleRowClick}
      >
        {node.type === 'dir' ? (
          <>
            <button
              className="tree-chevron"
              onClick={handleChevronClick}
              tabIndex={-1}
            >
              {expanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
            <Folder size={14} className="tree-icon tree-icon--folder" />
          </>
        ) : (
          <>
            <span style={{ width: 14, flexShrink: 0 }} />
            <FileText size={14} className="tree-icon tree-icon--file" />
          </>
        )}
        <span className="tree-item-name">
          {node.name.replace(/\.md$/, '')}
        </span>
      </div>
      {node.type === 'dir' &&
        expanded &&
        node.children?.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            currentPath={currentPath}
            selectedFolderPath={selectedFolderPath}
            onOpen={onOpen}
            onSelectFolder={onSelectFolder}
          />
        ))}
    </div>
  );
}
