export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  children?: TreeNode[];
}

export interface NoteMeta {
  title: string;
  tags: string[];
  excerpt: string;
  path: string;
  sha: string;
}

export interface FileContent {
  path: string;
  content: string;
  sha: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
  updated_at: string;
}
