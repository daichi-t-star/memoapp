import * as db from "./db";
import { remapContent } from "./richtext";
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
export async function buildBackup(
  scope: string,
  notes: StoredNote[],
  pendingFile?: (path: string) => Blob | undefined,
  fetchMissing?: (path: string) => Promise<Blob>,
) {
  // Blob parts keep each attachment separate instead of building a giant JS
  // string (large Evernote collections exceed browser string-size limits).
  const record = (value: unknown) => new Blob([JSON.stringify(value), "\n"]);
  const parts: Blob[] = [
    record({
      format: "memoapp-backup",
      version: 3,
      stream: true,
      exportedAt: new Date().toISOString(),
    }),
  ];
  for (const n of notes)
    parts.push(record({ kind: "note", value: portable(n) }));
  const paths = new Set(
    notes.flatMap((n) =>
      n.attachments.filter((a) => !a.external).map((a) => a.path),
    ),
  );
  for (const path of paths) {
    let blob = pendingFile?.(path) || (await db.getBlob(scope, path));
    if (!blob && fetchMissing) {
      blob = await fetchMissing(path);
      await db.putBlob(scope, path, blob);
    }
    if (!blob)
      throw new Error(
        "未取得の添付があります。オンラインでGitHubに接続してから書き出してください。",
      );
    parts.push(
      record({
        kind: "file",
        value: { path, type: blob.type, data: await base64(blob) },
      }),
    );
  }
  parts.push(record({ kind: "end", notes: notes.length, files: paths.size }));
  return new Blob(parts, { type: "application/x-ndjson" });
}
export async function exportBackup(
  scope: string,
  notes: StoredNote[],
  pendingFile?: (path: string) => Blob | undefined,
  fetchMissing?: (path: string) => Promise<Blob>,
) {
  download(
    await buildBackup(scope, notes, pendingFile, fetchMissing),
    `memoapp-backup-${new Date().toISOString().slice(0, 10)}.jsonl`,
  );
  return 0;
}
async function readBackup(file: File) {
  const notes: Note[] = [],
    blobs = new Map<string, Blob>();
  function binary(value: any) {
    if (
      !value ||
      typeof value.path !== "string" ||
      typeof value.type !== "string" ||
      typeof value.data !== "string" ||
      blobs.has(value.path)
    )
      throw new Error("バックアップの添付データが正しくありません。");
    const decoded = atob(value.data),
      bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    blobs.set(value.path, new Blob([bytes], { type: value.type }));
  }
  const prefix = await file.slice(0, 512).text();
  let header: any;
  try {
    header = JSON.parse(prefix.split("\n")[0]);
  } catch {
    /* legacy JSON */
  }
  if (
    header?.format === "memoapp-backup" &&
    header.stream === true &&
    header.version === 3
  ) {
    let first = true,
      ended = false;
    let fragments: string[] = [];
    function line(value: string) {
      if (!value.trim()) return;
      const row = JSON.parse(value);
      if (first) {
        first = false;
        return;
      }
      if (ended) throw new Error("バックアップの末尾が正しくありません。");
      if (row.kind === "note") notes.push(validateNote(row.value));
      else if (row.kind === "file") binary(row.value);
      else if (
        row.kind === "end" &&
        row.notes === notes.length &&
        row.files === blobs.size
      )
        ended = true;
      else throw new Error("バックアップの件数または形式が正しくありません。");
    }
    const reader = file.stream().getReader(),
      decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        const chunk = done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });
        let start = 0,
          pos;
        while ((pos = chunk.indexOf("\n", start)) >= 0) {
          fragments.push(chunk.slice(start, pos));
          line(fragments.join(""));
          fragments = [];
          start = pos + 1;
        }
        if (start < chunk.length) fragments.push(chunk.slice(start));
        if (done) break;
      }
      const carry = fragments.join("");
      if (carry.trim()) line(carry);
      if (!ended)
        throw new Error(
          "途中で切れたバックアップです。元の端末から再度書き出してください。",
        );
    } finally {
      reader.releaseLock();
    }
  } else {
    const backup = JSON.parse(await file.text());
    if (
      backup.format !== "memoapp-backup" ||
      ![2, 3].includes(backup.version) ||
      !Array.isArray(backup.notes) ||
      !Array.isArray(backup.files)
    )
      throw new Error("MemoAppのバックアップファイルを選んでください。");
    notes.push(...backup.notes.map(validateNote));
    for (const value of backup.files) binary(value);
  }
  return { notes, blobs };
}
export async function importBackup(file: File, scope: string) {
  const { notes, blobs } = await readBackup(file);
  // Validate the whole backup before writing anything. Copies avoid overwriting existing notes.
  for (const note of notes)
    for (const a of note.attachments)
      if (
        !a.external &&
        (!blobs.has(a.path) || blobs.get(a.path)!.size !== a.size)
      )
        throw new Error(
          "添付の実体が不足したバックアップです。元の端末で添付を取得してから再書き出ししてください。",
        );
  const restored: StoredNote[] = [];
  const restoredFiles: { scope: string; path: string; blob: Blob }[] = [];
  const imported = new Set(
    (await db.allNotes(scope)).map((n) => n.importKey).filter(Boolean),
  );
  for (const n of notes) {
    if (n.importKey && imported.has(n.importKey)) continue;
    if (n.importKey) imported.add(n.importKey);
    const ids = new Map(n.attachments.map((a) => [a.id, crypto.randomUUID()]));
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
      updatedAt: n.updatedAt,
      version: n.version,
      content: remapContent(n.content, ids),
      sourceHtml: n.sourceHtml?.replace(
        /data-attachment-id="([^"]+)"/g,
        (match, id) => `data-attachment-id="${ids.get(id) || id}"`,
      ),
      attachments: n.attachments.map((a) => ({
        ...a,
        id: ids.get(a.id)!,
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
  return restored.length;
}
