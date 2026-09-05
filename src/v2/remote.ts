import * as db from "./db";
import {
  isPending,
  notePath,
  portable,
  validateNote,
  type Connection,
  type StoredNote,
  type Repository,
} from "./model";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class Remote {
  constructor(
    private token: string,
    public connection: Connection,
  ) {}
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        response.status === 401
          ? "GitHubの認証が切れています。設定から再接続してください。"
          : response.status === 403 || response.status === 429
            ? "GitHubの権限または利用制限を確認してください。編集内容は端末に残っています。"
            : response.status === 409 || response.status === 422
              ? "GitHub側で更新がありました。「今すぐ同期」で再試行してください。"
              : `GitHubに接続できません (${response.status})。${detail.message || ""}`,
      );
    }
    return response.json();
  }
  base() {
    return `/repos/${encodeURIComponent(this.connection.owner)}/${encodeURIComponent(this.connection.repo)}`;
  }
  async user() {
    return this.request<{ login: string }>("/user");
  }
  async repos(): Promise<Repository[]> {
    const result: Repository[] = [];
    for (let page = 1; page <= 20; page++) {
      const rows = await this.request<Repository[]>(
        `/user/repos?sort=updated&per_page=100&page=${page}`,
      );
      result.push(...rows);
      if (rows.length < 100) break;
    }
    return result;
  }
  async tree() {
    const ref = await this.request<{ object: { sha: string } }>(
      `${this.base()}/git/ref/heads/${encodeURIComponent(this.connection.branch)}`,
    );
    const data = await this.request<{
      sha: string;
      truncated: boolean;
      tree: { path: string; sha: string; type: string }[];
    }>(`${this.base()}/git/trees/${ref.object.sha}?recursive=1`);
    if (data.truncated)
      throw new Error(
        "リポジトリが大きすぎて全件を確認できません。メモ専用の保存先を選んでください。",
      );
    return { ...data, head: ref.object.sha };
  }
  async blob(path: string, ref = this.connection.branch): Promise<Blob> {
    const response = await fetch(
      `https://api.github.com${this.base()}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github.raw+json",
        },
      },
    );
    if (!response.ok)
      throw new ApiError(
        response.status,
        "ファイルを読み込めませんでした。接続を確認して再試行してください。",
      );
    return response.blob();
  }
  async commit(
    head: string,
    baseTree: string,
    files: { path: string; content: string; encoding: "utf-8" | "base64" }[],
  ) {
    const entries: { path: string; mode: string; type: string; sha: string }[] =
      [];
    // Serial writes avoid secondary rate limits and partial Contents API commits.
    for (const file of files) {
      const blob = await this.request<{ sha: string }>(
        `${this.base()}/git/blobs`,
        "POST",
        { content: file.content, encoding: file.encoding },
      );
      entries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
    const tree = await this.request<{ sha: string }>(
      `${this.base()}/git/trees`,
      "POST",
      { base_tree: baseTree, tree: entries },
    );
    const commit = await this.request<{ sha: string }>(
      `${this.base()}/git/commits`,
      "POST",
      {
        message: "MemoApp: sync notes and attachments",
        tree: tree.sha,
        parents: [head],
      },
    );
    await this.request(
      `${this.base()}/git/refs/heads/${encodeURIComponent(this.connection.branch)}`,
      "PATCH",
      { sha: commit.sha, force: false },
    );
    return new Map(entries.map((e) => [e.path, e.sha]));
  }
}

export async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export async function synchronize(
  remote: Remote,
  scope: string,
  progress: (message: string) => void,
  changed: () => Promise<void>,
) {
  progress("変更を確認しています…");
  const tree = await remote.tree();
  const remoteFiles = new Map(
    tree.tree.filter((f) => f.type === "blob").map((f) => [f.path, f.sha]),
  );
  const notes = await db.allNotes(scope);
  const remoteNotes = tree.tree.filter(
    (f) =>
      f.type === "blob" &&
      /^\.memoapp\/notes\/[a-zA-Z0-9_-]+\.json$/.test(f.path),
  );
  let completed = 0;
  for (const file of remoteNotes) {
    const id = file.path
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    let existing = await db.getNote(scope, id);
    if (existing?.remoteSha === file.sha) continue;
    const note = validateNote(
      JSON.parse(await (await remote.blob(file.path, tree.head)).text()),
    );
    if (note.id !== id)
      throw new Error(
        "メモのIDと保存先が一致しません。元のデータを保護して同期を停止しました。",
      );
    const incoming: StoredNote = {
      ...note,
      scope,
      revision: file.sha,
      syncedRevision: file.sha,
      remoteSha: file.sha,
    };
    // Retry only local CAS, never the network mutation. Preserve both versions on conflict.
    let accepted = false;
    for (let attempt = 0; attempt < 5 && !accepted; attempt++) {
      existing = await db.getNote(scope, id);
      let conflictCopy: StoredNote | undefined;
      if (existing && isPending(existing)) {
        if (
          JSON.stringify(validateNote(portable(existing))) ===
          JSON.stringify(note)
        ) {
          await db.markSynced(scope, id, existing.revision, file.sha);
          accepted = true;
          break;
        }
        conflictCopy = {
          ...existing,
          id: crypto.randomUUID(),
          title: `${existing.title || "無題のメモ"}（この端末の変更）`,
          sourcePath: undefined,
          remoteSha: undefined,
          legacySha: undefined,
          revision: crypto.randomUUID(),
          syncedRevision: "",
        };
        progress("同時編集を検出しました。両方のメモを保存しています。");
      }
      accepted = await db.acceptRemote(
        incoming,
        existing?.revision,
        conflictCopy,
      );
    }
    if (!accepted)
      throw new Error(
        "編集中のメモがあります。入力が落ち着いてから同期してください。",
      );
    progress(`メモを取得しています ${++completed} / ${remoteNotes.length}`);
    await changed();
  }
  const current = await db.allNotes(scope);
  const migrated = new Set(
    current
      .filter((n) => n.remoteSha || isPending(n))
      .map((n) => n.sourcePath)
      .filter(Boolean),
  );
  const legacy = tree.tree.filter(
    (f) =>
      f.type === "blob" &&
      /\.md$/i.test(f.path) &&
      !f.path.split("/").some((part) => part.startsWith(".")) &&
      !migrated.has(f.path),
  );
  const cachedSources = new Map(
    current.filter((n) => n.sourcePath).map((n) => [n.sourcePath, n]),
  );
  const missing = legacy.filter(
    (f) => cachedSources.get(f.path)?.legacySha !== f.sha,
  );
  if (missing.length) {
    const { importLegacy } = await import("./legacy");
    let index = 0;
    let done = 0;
    // Three background readers; no per-note commit history requests.
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(3, missing.length) }, async () => {
        while (index < missing.length) {
          const file = missing[index++];
          const old = cachedSources.get(file.path);
          const imported = await importLegacy(
            await (await remote.blob(file.path, tree.head)).text(),
            file.path,
            file.sha,
            scope,
          );
          if (old) {
            imported.createdAt = old.createdAt;
            imported.updatedAt = old.updatedAt;
          }
          await db.acceptRemote(imported, old?.revision);
          progress(`以前のメモを取り込み中 ${++done} / ${missing.length}`);
          await changed();
        }
      }),
    );
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  // Preserve remotely removed notes in local trash; keep concurrent local edits as a new copy.
  for (const old of notes.filter(
    (n) => n.remoteSha && !remoteFiles.has(notePath(n.id)),
  )) {
    const latest = await db.getNote(scope, old.id);
    if (!latest) continue;
    const copy: StoredNote | undefined = isPending(latest)
      ? {
          ...latest,
          id: crypto.randomUUID(),
          title: `${latest.title || "無題のメモ"}（この端末の変更）`,
          sourcePath: undefined,
          remoteSha: undefined,
          legacySha: undefined,
          revision: crypto.randomUUID(),
          syncedRevision: "",
        }
      : undefined;
    await db.acceptRemote(
      {
        ...latest,
        deleted: true,
        sourcePath: undefined,
        remoteSha: undefined,
        revision: latest.revision,
        syncedRevision: latest.revision,
      },
      latest.revision,
      copy,
    );
    await changed();
  }
  const pending = (await db.allNotes(scope)).filter(isPending);
  if (!pending.length) return;
  const files: {
    path: string;
    content: string;
    encoding: "utf-8" | "base64";
  }[] = [];
  const included = new Set<string>();
  for (const note of pending) {
    for (const attachment of note.attachments) {
      if (
        attachment.external ||
        remoteFiles.has(attachment.path) ||
        included.has(attachment.path)
      )
        continue;
      const blob = await db.getBlob(scope, attachment.path);
      if (!blob)
        throw new Error(
          `「${attachment.name}」の実体が見つかりません。メモは端末に保持されています。`,
        );
      progress(`添付ファイルを準備中：${attachment.name}`);
      files.push({
        path: attachment.path,
        content: await base64(blob),
        encoding: "base64",
      });
      included.add(attachment.path);
    }
    files.push({
      path: notePath(note.id),
      content: JSON.stringify(portable(note)),
      encoding: "utf-8",
    });
  }
  progress(`${pending.length}件のメモと添付を同期しています…`);
  const shas = await remote.commit(tree.head, tree.sha, files);
  for (const note of pending)
    await db.markSynced(
      scope,
      note.id,
      note.revision,
      shas.get(notePath(note.id))!,
    );
  await changed();
}
