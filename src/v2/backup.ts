import * as db from "./db";
import { base64 } from "./remote";
import {
  portable,
  validateNote,
  newNote,
  type StoredNote,
  type Note,
} from "./model";

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportBackup(
  scope: string,
  notes: StoredNote[],
  pendingFile?: (path: string) => Blob | undefined,
  fetchMissing?: (path: string) => Promise<Blob>,
) {
  const paths = new Set(
    notes.flatMap((n) =>
      n.attachments.filter((a) => !a.external).map((a) => a.path),
    ),
  );
  const files = [];
  const missing = [];
  for (const path of paths) {
    let blob = pendingFile?.(path) || (await db.getBlob(scope, path));
    if (!blob && fetchMissing) {
      blob = await fetchMissing(path);
      await db.putBlob(scope, path, blob);
    }
    if (blob) files.push({ path, type: blob.type, data: await base64(blob) });
    else missing.push(path);
  }
  if (missing.length)
    throw new Error(
      `未取得の添付が${missing.length}件あります。オンラインでGitHubに接続してから書き出してください。`,
    );
  download(
    new Blob(
      [
        JSON.stringify({
          format: "memoapp-backup",
          version: 2,
          exportedAt: new Date().toISOString(),
          notes: notes.map(portable),
          files,
          missing,
        }),
      ],
      { type: "application/json" },
    ),
    `memoapp-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
  return missing.length;
}
export async function importBackup(file: File, scope: string) {
  const backup = JSON.parse(await file.text());
  if (
    backup.format !== "memoapp-backup" ||
    backup.version !== 2 ||
    !Array.isArray(backup.notes) ||
    !Array.isArray(backup.files)
  )
    throw new Error("MemoAppのバックアップファイルを選んでください。");
  const notes: Note[] = backup.notes.map(validateNote);
  const blobs = new Map<string, Blob>();
  for (const file of backup.files) {
    if (
      typeof file.path !== "string" ||
      typeof file.data !== "string" ||
      typeof file.type !== "string"
    )
      throw new Error("バックアップの添付データが正しくありません。");
    blobs.set(
      file.path,
      new Blob([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], {
        type: file.type,
      }),
    );
  }
  // Validate the whole backup before writing anything. Copies avoid overwriting existing notes.
  for (const note of notes)
    for (const a of note.attachments)
      if (!a.external && !blobs.has(a.path))
        throw new Error(
          "添付の実体が不足したバックアップです。元の端末で添付を取得してから再書き出ししてください。",
        );
  const restored: StoredNote[] = [];
  const restoredFiles: { scope: string; path: string; blob: Blob }[] = [];
  for (const n of notes) {
    const note: StoredNote = {
      ...n,
      ...newNote(scope, n.folder),
      title: n.title,
      text: n.text,
      tags: n.tags,
      pinned: n.pinned,
      archived: n.archived,
      deleted: n.deleted,
      createdAt: n.createdAt,
      attachments: n.attachments.map((a) => ({
        ...a,
        id: crypto.randomUUID(),
        path: a.external
          ? a.path
          : `.memoapp/attachments/${crypto.randomUUID()}/${a.name.replace(/[^\p{L}\p{N}._-]/gu, "_") || "file"}`,
      })),
    };
    delete note.sourcePath;
    restored.push(note);
    restoredFiles.push(
      ...note.attachments.flatMap((a, i) =>
        a.external
          ? []
          : [{ scope, path: a.path, blob: blobs.get(n.attachments[i].path)! }],
      ),
    );
  }
  await db.putBackup(restored, restoredFiles);
  return notes.length;
}
