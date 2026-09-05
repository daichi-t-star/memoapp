import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import * as db from "../src/v2/db.ts";
import {
  newNote,
  portable,
  notePath,
  isPending,
  validateNote,
} from "../src/v2/model.ts";
import { importLegacy } from "../src/v2/legacy.ts";
import { Remote, synchronize, base64 } from "../src/v2/remote.ts";
import { NoteStore } from "../src/v2/store.ts";
import { importBackup } from "../src/v2/backup.ts";

const scope = () => crypto.randomUUID();
const changed = async () => {};
class FakeRemote extends Remote {
  files = new Map<string, { sha: string; text: string }>();
  downloads: string[] = [];
  commits: any[][] = [];
  fail = false;
  duringCommit?: () => Promise<void>;
  constructor() {
    super("fake-test-token", { owner: "test", repo: "notes", branch: "main" });
  }
  async tree() {
    return {
      sha: "tree",
      head: "head",
      truncated: false,
      tree: [...this.files].map(([path, f]) => ({
        path,
        sha: f.sha,
        type: "blob",
      })),
    };
  }
  async blob(path: string) {
    this.downloads.push(path);
    const file = this.files.get(path);
    if (!file) throw new Error("missing");
    return new Blob([file.text]);
  }
  async commit(_h: string, _t: string, files: any[]) {
    this.commits.push(files);
    await this.duringCommit?.();
    if (this.fail) throw new Error("network failed before branch update");
    const result = new Map<string, string>();
    for (const f of files) {
      const sha = crypto.randomUUID();
      result.set(f.path, sha);
      this.files.set(f.path, { sha, text: f.content });
    }
    return result;
  }
}

test("local note + binary persist together, scoped away from other repositories", async () => {
  const n = newNote(scope());
  n.title = "日本語メモ";
  n.text = "改行\n絵文字📝";
  const bytes = new Uint8Array([0, 255, 128, 1, 0, 254]);
  await db.putNoteWithFiles(n, [
    { path: "photo.png", blob: new Blob([bytes]) },
  ]);
  assert.equal((await db.allNotes(n.scope))[0].text, n.text);
  assert.deepEqual(
    new Uint8Array(
      await (await db.getBlob(n.scope, "photo.png"))!.arrayBuffer(),
    ),
    bytes,
  );
  assert.equal((await db.allNotes(scope())).length, 0);
  assert.equal(await db.getBlob(scope(), "photo.png"), undefined);
});

test("rapid typing, IME text and title changes survive reopening the store", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  const jobs = [];
  for (let i = 0; i < 50; i++)
    jobs.push(
      s.update(id, { text: `入力中 ${i} 日本語`, title: `タイトル ${i}` }),
    );
  await Promise.all(jobs);
  await s.flush();
  const reopened = new NoteStore(s.scope);
  await reopened.refresh();
  assert.equal(reopened.snapshot.notes[0].text, "入力中 49 日本語");
  assert.equal(reopened.snapshot.notes[0].title, "タイトル 49");
});

test("multiple image/file attachment, removal, trash and restoration survive reload", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  await s.attach(id, [
    new File(["PDF data"], "資料 (日本語).pdf", { type: "application/pdf" }),
    new File(["image"], "写真.png", { type: "image/png" }),
  ]);
  const n = (await db.allNotes(s.scope))[0];
  assert.equal(n.attachments.length, 2);
  assert.equal(
    await (await db.getBlob(s.scope, n.attachments[0].path))!.text(),
    "PDF data",
  );
  await s.update(id, { deleted: true });
  assert.equal((await db.getNote(s.scope, id))!.deleted, true);
  await s.update(id, { deleted: false, attachments: n.attachments.slice(1) });
  assert.equal((await db.getNote(s.scope, id))!.attachments.length, 1);
  assert.equal((await db.getNote(s.scope, id))!.deleted, false);
  assert.ok(
    await db.getBlob(s.scope, n.attachments[0].path),
    "detaching does not destroy the recoverable binary",
  );
});

test("oversize attachment fails before changing the note", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  await assert.rejects(
    s.attach(id, [
      new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.bin"),
    ]),
    /20 MB/,
  );
  assert.equal((await db.getNote(s.scope, id))!.attachments.length, 0);
});

test("legacy markdown is converted to plain text, including tables, tasks, references and relative images", async () => {
  const source =
    '---\ntitle: "昔のメモ"\ntags: [仕事, 資料]\n---\n# 見出し\n\n**太字** と [URL](https://example.com)\n\n- [x] 完了\n- [ ] 未完了\n\n![写真](<../assets/日本語 写真.png>)\n\n![参照][pic]\n\n[pic]: /assets/second.jpg\n\n|項目|数|\n|---|---|\n|りんご|2|\n';
  const n = await importLegacy(source, "仕事/note.md", "oldsha", scope());
  assert.equal(n.title, "昔のメモ");
  assert.deepEqual(n.tags, ["仕事", "資料"]);
  assert.match(n.text, /見出し/);
  assert.match(n.text, /太字 と URL \(https:\/\/example.com\)/);
  assert.match(n.text, /☑ 完了/);
  assert.match(n.text, /☐ 未完了/);
  assert.match(n.text, /りんご　\|　2/);
  assert.doesNotMatch(n.text, /\*\*|!\[/);
  assert.equal(n.attachments[0].path, "assets/日本語 写真.png");
  assert.equal(n.attachments[1].path, "assets/second.jpg");
  assert.equal(n.sourcePath, "仕事/note.md");
  assert.equal(isPending(n), false);
  assert.equal(
    (await importLegacy(source, "仕事/note.md", "newsha", scope())).id,
    n.id,
  );
});

test("first legacy import is read-only and repeat sync skips all unchanged contents", async () => {
  const remote = new FakeRemote();
  const s = scope();
  remote.files.set("notes/old.md", { sha: "a", text: "# Old\n\nold body" });
  await synchronize(remote, s, () => {}, changed);
  assert.equal((await db.allNotes(s)).length, 1);
  assert.equal(remote.commits.length, 0);
  assert.deepEqual(remote.downloads, ["notes/old.md"]);
  remote.downloads = [];
  await synchronize(remote, s, () => {}, changed);
  assert.deepEqual(remote.downloads, []);
  assert.equal(remote.commits.length, 0);
});

test("sync atomically publishes note + attachment, preserves legacy source", async () => {
  const remote = new FakeRemote();
  const s = scope();
  remote.files.set("legacy.md", { sha: "old", text: "# 原文\n\n旧メモ" });
  await synchronize(remote, s, () => {}, changed);
  const store = new NoteStore(s);
  await store.refresh();
  const id = store.snapshot.notes[0].id;
  await store.update(id, { text: "普通の文章に編集" });
  await store.attach(id, [
    new File([new Uint8Array([0, 255, 128])], "資料.pdf", {
      type: "application/pdf",
    }),
  ]);
  await synchronize(remote, s, () => {}, changed);
  assert.equal(remote.commits.length, 1);
  assert.equal(remote.commits[0].length, 2);
  assert.equal(remote.files.get("legacy.md")!.text, "# 原文\n\n旧メモ");
  const local = (await db.allNotes(s))[0];
  assert.equal(isPending(local), false);
  assert.equal(
    JSON.parse(remote.files.get(notePath(id))!.text).text,
    "普通の文章に編集",
  );
  remote.downloads = [];
  await synchronize(remote, s, () => {}, changed);
  assert.deepEqual(remote.downloads, []);
});

test("failed publication leaves note and file in a retryable local queue", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  await s.update(id, { text: "保存しておく" });
  await s.attach(id, [new File(["binary"], "file.bin")]);
  const remote = new FakeRemote();
  remote.fail = true;
  await assert.rejects(
    synchronize(remote, s.scope, () => {}, changed),
    /network failed/,
  );
  const failed = (await db.allNotes(s.scope))[0];
  assert.ok(isPending(failed));
  assert.ok(await db.getBlob(s.scope, failed.attachments[0].path));
  assert.equal(remote.files.size, 0);
  remote.fail = false;
  await synchronize(remote, s.scope, () => {}, changed);
  assert.equal(isPending((await db.allNotes(s.scope))[0]), false);
});

test("typing during upload stays pending and the latest text is sent in the next sync", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  await s.update(id, { text: "version one" });
  const remote = new FakeRemote();
  remote.duringCommit = async () => {
    await s.update(id, { text: "version two 日本語" });
  };
  await synchronize(remote, s.scope, () => {}, changed);
  let n = (await db.allNotes(s.scope))[0];
  assert.equal(n.text, "version two 日本語");
  assert.equal(isPending(n), true);
  await s.refresh();
  remote.duringCommit = undefined;
  await synchronize(remote, s.scope, () => {}, changed);
  n = (await db.allNotes(s.scope))[0];
  assert.equal(isPending(n), false);
  assert.equal(
    JSON.parse(remote.files.get(notePath(id))!.text).text,
    "version two 日本語",
  );
});

test("both versions survive concurrent device edits", async () => {
  const s = scope();
  const n = newNote(s);
  n.text = "local edit";
  n.remoteSha = "base";
  n.syncedRevision = "previous";
  await db.putNote(n);
  const remote = new FakeRemote();
  remote.files.set(notePath(n.id), {
    sha: "remote-new",
    text: JSON.stringify({ ...portable(n), text: "remote edit" }),
  });
  await synchronize(remote, s, () => {}, changed);
  const notes = await db.allNotes(s);
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map((n) => n.text).sort(), [
    "local edit",
    "remote edit",
  ]);
  assert.equal(notes.find((x) => x.id === n.id)!.text, "remote edit");
});

test("CAS refuses stale network overwrite and a sync receipt cannot erase new input", async () => {
  const n = newNote(scope());
  await db.putNote(n);
  const edited = { ...n, text: "new", revision: "new" };
  await db.putNote(edited);
  assert.equal(
    await db.acceptRemote({ ...n, text: "stale" }, n.revision),
    false,
  );
  await db.markSynced(n.scope, n.id, n.revision, "remote");
  const saved = (await db.getNote(n.scope, n.id))!;
  assert.equal(saved.text, "new");
  assert.equal(saved.revision, "new");
  assert.ok(isPending(saved));
  assert.equal(saved.remoteSha, "remote");
});

test("malformed remote note cannot inject local bookkeeping or unsafe attachment URLs", () => {
  const n = newNote(scope());
  assert.throws(() => validateNote({ ...n, id: "../overwrite" }));
  const result = validateNote({
    ...portable(n),
    scope: "other",
    syncedRevision: "malicious",
  });
  assert.equal("scope" in result, false);
  assert.equal("syncedRevision" in result, false);
  assert.throws(() =>
    validateNote({
      ...n,
      attachments: [
        {
          id: "1",
          name: "bad",
          type: "text/html",
          size: 1,
          path: "javascript:alert(1)",
          external: true,
        },
      ],
    }),
  );
});

test("backup restore creates copies with binary files and cannot overwrite existing notes", async () => {
  const s = scope();
  const n = newNote(s);
  n.text = "original";
  await db.putNote(n);
  const backup = {
    format: "memoapp-backup",
    version: 2,
    notes: [
      {
        ...portable(n),
        text: "restored",
        attachments: [
          {
            id: "a",
            name: "資料.pdf",
            path: "old/file.pdf",
            type: "application/pdf",
            size: 3,
          },
        ],
      },
    ],
    files: [
      { path: "old/file.pdf", type: "application/pdf", data: btoa("pdf") },
    ],
  };
  await importBackup(new File([JSON.stringify(backup)], "backup.json"), s);
  const notes = await db.allNotes(s);
  assert.equal(notes.length, 2);
  assert.equal(notes.find((x) => x.id === n.id)!.text, "original");
  const copy = notes.find((x) => x.id !== n.id)!;
  assert.equal(copy.text, "restored");
  assert.equal(
    await (await db.getBlob(s, copy.attachments[0].path))!.text(),
    "pdf",
  );
  assert.ok(isPending(copy));
});

test("binary base64 handles large buffers without call-stack overflow", async () => {
  const data = new Uint8Array(2 * 1024 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i % 256;
  const result = await base64(new Blob([data]));
  assert.equal(atob(result).length, data.length);
  assert.equal(atob(result).charCodeAt(255), 255);
});

test("unknown publication outcome is reconciled without duplicate notes on retry", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  await s.attach(id, [new File(["image"], "test.png", { type: "image/png" })]);
  const remote = new FakeRemote();
  const original = remote.commit.bind(remote);
  remote.commit = async (...args) => {
    await original(...args);
    throw new Error("response lost after commit");
  };
  await assert.rejects(
    synchronize(remote, s.scope, () => {}, changed),
    /response lost/,
  );
  assert.ok(isPending((await db.allNotes(s.scope))[0]));
  remote.commit = original;
  await synchronize(remote, s.scope, () => {}, changed);
  const notes = await db.allNotes(s.scope);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, id);
  assert.equal(isPending(notes[0]), false);
});

test("remote removal moves cached note to trash and preserves concurrent local edits", async () => {
  const s = scope();
  const n = newNote(s);
  n.title = "Local";
  n.text = "unsynced";
  n.remoteSha = "old";
  n.syncedRevision = "previous";
  await db.putNote(n);
  const remote = new FakeRemote();
  await synchronize(remote, s, () => {}, changed);
  const notes = await db.allNotes(s);
  assert.equal(notes.length, 2);
  assert.equal(notes.find((x) => x.id === n.id)!.deleted, true);
  const copy = notes.find((x) => x.id !== n.id)!;
  assert.equal(copy.text, "unsynced");
  assert.equal(copy.deleted, false);
  assert.ok(remote.files.has(notePath(copy.id)));
});

test("failed local transaction rolls back binary writes and retry retains original attachment bytes", async () => {
  const s = new NoteStore(scope());
  await s.refresh();
  const id = await s.create();
  const original = IDBObjectStore.prototype.put;
  let failed = false;
  IDBObjectStore.prototype.put = function (
    ...args: Parameters<typeof original>
  ) {
    if (this.name === "notes" && !failed) {
      failed = true;
      throw new DOMException("Full", "QuotaExceededError");
    }
    return original.apply(this, args);
  };
  try {
    await assert.rejects(
      s.attach(id, [new File(["preserve me"], "saved.txt")]),
      /Full/,
    );
    await s.flush();
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  const path = s.snapshot.notes[0].attachments[0].path;
  assert.equal(
    await db.getBlob(s.scope, path),
    undefined,
    "binary put must be rolled back with the note",
  );
  assert.equal(
    s.pendingFiles.size,
    1,
    "original bytes remain available for retry and backup",
  );
  assert.ok(s.snapshot.error);
  await s.retry();
  assert.equal(await (await db.getBlob(s.scope, path))!.text(), "preserve me");
  assert.equal((await db.getNote(s.scope, id))!.attachments.length, 1);
  assert.equal(s.pendingFiles.size, 0);
  assert.equal(s.snapshot.error, "");
});
