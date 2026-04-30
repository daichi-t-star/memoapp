import type { TreeNode, GitHubTreeItem } from '../types';

export function buildTree(items: GitHubTreeItem[]): TreeNode[] {
  const root: TreeNode = {
    name: '',
    path: '',
    type: 'dir',
    sha: '',
    children: [],
  };

  const mdFiles = items.filter(
    (i) =>
      i.type === 'blob' &&
      i.path.endsWith('.md') &&
      !i.path.startsWith('.trash/') &&
      i.path !== '.trash',
  );

  for (const file of mdFiles) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1;

      if (!current.children) current.children = [];
      let child = current.children.find((c) => c.name === name);
      if (!child) {
        child = {
          name,
          path,
          type: isFile ? 'file' : 'dir',
          sha: isFile ? file.sha : '',
          children: isFile ? undefined : [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  sortTree(root.children!);
  return root.children!;
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

export function collectFolderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.type === 'dir') {
        paths.push(node.path);
        if (node.children) walk(node.children);
      }
    }
  }
  walk(nodes);
  return paths.sort();
}

export function insertFileIntoTree(
  nodes: TreeNode[],
  path: string,
  sha: string,
): TreeNode[] {
  const root: TreeNode = {
    name: '',
    path: '',
    type: 'dir',
    sha: '',
    children: nodes.map(cloneNode),
  };

  const parts = path.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const nodePath = parts.slice(0, i + 1).join('/');
    const isFile = i === parts.length - 1;

    if (!current.children) current.children = [];
    let child = current.children.find((c) => c.name === name);
    if (!child) {
      child = {
        name,
        path: nodePath,
        type: isFile ? 'file' : 'dir',
        sha: isFile ? sha : '',
        children: isFile ? undefined : [],
      };
      current.children.push(child);
    } else if (isFile) {
      child.sha = sha;
    }
    current = child;
  }

  sortTree(root.children!);
  return root.children!;
}

export function removeFileFromTree(
  nodes: TreeNode[],
  path: string,
): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.path === path && node.type === 'file') continue;
    if (node.children) {
      const newChildren = removeFileFromTree(node.children, path);
      if (node.type === 'dir' && newChildren.length === 0) continue;
      result.push({ ...node, children: newChildren });
    } else {
      result.push(node);
    }
  }
  return result;
}

function cloneNode(node: TreeNode): TreeNode {
  return {
    ...node,
    children: node.children ? node.children.map(cloneNode) : undefined,
  };
}

export function flattenMdFiles(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.type === 'file') result.push(node);
      else if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return result;
}
