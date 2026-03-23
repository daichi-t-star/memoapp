import type { GitHubTreeItem, GitHubRepo, GitHubUser } from '../types';

const API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubClient {
  constructor(private token: string) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new GitHubError(res.status, body.message || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  async getUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>('/user');
  }

  async listRepos(): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>(
      '/user/repos?sort=updated&per_page=100&type=all',
    );
  }

  async getTree(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{ sha: string; tree: GitHubTreeItem[] }> {
    const ref = await this.request<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return this.request(
      `/repos/${owner}/${repo}/git/trees/${ref.object.sha}?recursive=1`,
    );
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ) {
    const encodedPath = encodePath(path);
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const data = await this.request<{
      content: string;
      sha: string;
      encoding: string;
    }>(`/repos/${owner}/${repo}/contents/${encodedPath}${query}`);
    return {
      sha: data.sha,
      decodedContent:
        data.encoding === 'base64'
          ? base64ToUtf8(data.content)
          : data.content,
    };
  }

  async putFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    sha?: string,
    branch?: string,
  ) {
    const encodedPath = encodePath(path);
    const body: Record<string, string> = {
      message,
      content: utf8ToBase64(content),
    };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    return this.request<{ content: { sha: string; path: string } }>(
      `/repos/${owner}/${repo}/contents/${encodedPath}`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  }

  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    sha: string,
    message: string,
    branch?: string,
  ) {
    const encodedPath = encodePath(path);
    const body: Record<string, string> = { message, sha };
    if (branch) body.branch = branch;
    return this.request<void>(
      `/repos/${owner}/${repo}/contents/${encodedPath}`,
      { method: 'DELETE', body: JSON.stringify(body) },
    );
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const cleaned = base64.replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
