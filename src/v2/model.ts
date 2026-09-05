export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  external?: boolean;
}

export interface Note {
  version: 2;
  id: string;
  title: string;
  text: string;
  folder: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
  sourcePath?: string;
}

export interface StoredNote extends Note {
  scope: string;
  revision: string;
  syncedRevision: string;
  remoteSha?: string;
  legacySha?: string;
}

export interface Connection {
  owner: string;
  repo: string;
  branch: string;
}
export interface Repository {
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const scopeOf = (c: Connection | null) =>
  c ? `${c.owner}/${c.repo}@${c.branch}` : "local";
export const notePath = (id: string) => `.memoapp/notes/${id}.json`;
export const isImage = (a: Attachment) =>
  /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(a.type);
export const isPending = (n: StoredNote) => n.revision !== n.syncedRevision;
export function newNote(scope: string, folder = ""): StoredNote {
  const now = new Date().toISOString();
  return {
    version: 2,
    id: crypto.randomUUID(),
    scope,
    title: "",
    text: "",
    folder,
    tags: [],
    pinned: false,
    archived: false,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    attachments: [],
    revision: crypto.randomUUID(),
    syncedRevision: "",
  };
}
export function portable(n: StoredNote): Note {
  const { scope, revision, syncedRevision, remoteSha, legacySha, ...note } = n;
  return note;
}
export function validateNote(value: unknown): Note {
  const n = value as Note;
  if (
    !n ||
    n.version !== 2 ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(n.id) ||
    !["title", "text", "folder", "createdAt", "updatedAt"].every(
      (k) => typeof (n as unknown as Record<string, unknown>)[k] === "string",
    ) ||
    !["pinned", "archived", "deleted"].every(
      (k) => typeof (n as unknown as Record<string, unknown>)[k] === "boolean",
    ) ||
    !Array.isArray(n.tags) ||
    !n.tags.every((t) => typeof t === "string") ||
    !Array.isArray(n.attachments) ||
    !Number.isFinite(Date.parse(n.updatedAt)) ||
    !Number.isFinite(Date.parse(n.createdAt)) ||
    (n.sourcePath !== undefined && typeof n.sourcePath !== "string")
  )
    throw new Error(
      "メモの形式を確認できません。元のデータは変更していません。",
    );
  for (const a of n.attachments) {
    if (
      !a ||
      !["id", "name", "type", "path"].every(
        (k) => typeof (a as unknown as Record<string, unknown>)[k] === "string",
      ) ||
      !Number.isFinite(a.size) ||
      a.size < 0 ||
      (a.external
        ? !/^https?:\/\//i.test(a.path)
        : a.path.startsWith("/") || a.path.split("/").includes(".."))
    )
      throw new Error("添付ファイルの形式が正しくありません。");
  }
  // Explicit projection: remote JSON must never supply local sync bookkeeping.
  return {
    version: 2,
    id: n.id,
    title: n.title,
    text: n.text,
    folder: n.folder,
    tags: n.tags,
    pinned: n.pinned,
    archived: n.archived,
    deleted: n.deleted,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    attachments: n.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      size: a.size,
      path: a.path,
      external: !!a.external,
    })),
    sourcePath: n.sourcePath,
  };
}
export function mimeFor(path: string): string {
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        pdf: "application/pdf",
        txt: "text/plain",
        csv: "text/csv",
      } as Record<string, string>
    )[path.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream"
  );
}
export function formatSize(size: number) {
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : size
      ? `${Math.max(1, Math.round(size / 1024))} KB`
      : "添付ファイル";
}
