import * as db from "./db";
import {
  newNote,
  type StoredNote,
  type Note,
  type Attachment,
  MAX_FILE_SIZE,
  mimeFor,
} from "./model";

export class NoteStore {
  snapshot: {
    notes: StoredNote[];
    loading: boolean;
    saving: boolean;
    error: string;
  } = { notes: [], loading: true, saving: false, error: "" };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private writes = 0;
  private generation = 0;
  readonly pendingFiles = new Map<string, Blob>();
  constructor(public scope: string) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  private emit(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  clearError = () => this.emit({ error: "" });
  async refresh() {
    await this.queue;
    const generation = this.generation;
    try {
      const notes = await db.allNotes(this.scope);
      if (generation === this.generation) this.emit({ notes, loading: false });
    } catch {
      this.emit({
        loading: false,
        error:
          "端末の保存領域を開けません。ブラウザのストレージ設定を確認してください。",
      });
    }
  }
  flush = () => this.queue;
  private persist(
    note: StoredNote,
    files: { path: string; blob: Blob }[] = [],
  ) {
    for (const file of files) this.pendingFiles.set(file.path, file.blob);
    this.generation++;
    this.writes++;
    this.emit({
      notes: [note, ...this.snapshot.notes.filter((n) => n.id !== note.id)],
      saving: true,
    });
    const task = this.queue.then(async () => {
      const latest = await db.getNote(this.scope, note.id);
      // Network acknowledgements may arrive after the UI snapshot; preserve them.
      const merged = {
        ...note,
        syncedRevision: latest?.syncedRevision ?? note.syncedRevision,
        remoteSha: latest?.remoteSha ?? note.remoteSha,
      };
      const binary = note.attachments.flatMap((a) =>
        this.pendingFiles.has(a.path)
          ? [{ path: a.path, blob: this.pendingFiles.get(a.path)! }]
          : [],
      );
      await db.putNoteWithFiles(merged, binary);
      for (const file of binary) this.pendingFiles.delete(file.path);
    });
    this.queue = task
      .catch(() => {
        this.emit({
          error:
            "端末への保存に失敗しました。画面を閉じず、バックアップを書き出してください。空き容量を確保してから再保存できます。",
        });
      })
      .finally(() => {
        this.writes--;
        this.emit({ saving: this.writes > 0 });
      });
    return task;
  }
  async create(folder = "", initial: Partial<Note> = {}) {
    const note = { ...newNote(this.scope, folder), ...initial };
    await this.persist(note);
    return note.id;
  }
  update(id: string, patch: Partial<Note>) {
    const current = this.snapshot.notes.find((n) => n.id === id);
    if (!current) return Promise.resolve();
    return this.persist({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      revision: crypto.randomUUID(),
    });
  }
  async attach(id: string, input: File[]) {
    if (input.some((f) => f.size > MAX_FILE_SIZE))
      throw new Error(
        "1ファイル20 MBまで添付できます。大きいファイルは分割してください。",
      );
    const note = this.snapshot.notes.find((n) => n.id === id);
    if (!note) return;
    const files = input.map((file) => {
      const uid = crypto.randomUUID();
      const safe =
        file.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120) || "file";
      const path = `.memoapp/attachments/${uid}/${safe}`;
      const attachment: Attachment = {
        id: uid,
        name: file.name,
        type: file.type || mimeFor(file.name),
        size: file.size,
        path,
      };
      return { attachment, blob: file };
    });
    await this.persist(
      {
        ...note,
        revision: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
        attachments: [...note.attachments, ...files.map((f) => f.attachment)],
      },
      files.map((f) => ({ path: f.attachment.path, blob: f.blob })),
    );
    navigator.storage?.persist?.().catch(() => {});
  }
  async duplicate(id: string) {
    const n = this.snapshot.notes.find((n) => n.id === id);
    if (!n) return;
    const copy = {
      ...n,
      ...newNote(this.scope, n.folder),
      title: `${n.title || "無題のメモ"}（コピー）`,
      text: n.text,
      tags: n.tags,
      attachments: n.attachments,
    };
    delete copy.sourcePath;
    delete copy.remoteSha;
    delete copy.legacySha;
    await this.persist(copy);
    return copy.id;
  }
  async retry() {
    const notes = this.snapshot.notes;
    for (const note of notes) await this.persist(note);
    this.clearError();
  }
}
