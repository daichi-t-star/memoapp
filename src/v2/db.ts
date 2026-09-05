import type { StoredNote } from "./model";

let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("memoapp-v2", 1);
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore("notes", { keyPath: ["scope", "id"] })
        .createIndex("scope", "scope");
      request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      database = undefined;
      reject(new Error("別のタブを閉じて、もう一度開いてください。"));
    };
  }));
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let request: IDBRequest<T>;
    try {
      request = run(tx);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () =>
      reject(
        tx.error ||
          new Error("端末に保存できません。空き容量を確認してください。"),
      );
  });
}
export const allNotes = (scope: string) =>
  transaction<StoredNote[]>(["notes"], "readonly", (tx) =>
    tx.objectStore("notes").index("scope").getAll(scope),
  );
export const getNote = (scope: string, id: string) =>
  transaction<StoredNote | undefined>(["notes"], "readonly", (tx) =>
    tx.objectStore("notes").get([scope, id]),
  );
export const putNote = (note: StoredNote) =>
  transaction(["notes"], "readwrite", (tx) =>
    tx.objectStore("notes").put(note),
  );
export const getBlob = (scope: string, path: string) =>
  transaction<Blob | undefined>(["files"], "readonly", (tx) =>
    tx.objectStore("files").get([scope, path]),
  );
export const putBlob = (scope: string, path: string, blob: Blob) =>
  transaction(["files"], "readwrite", (tx) =>
    tx.objectStore("files").put(blob, [scope, path]),
  );
// The note and all its attachments either persist together or none of them do.
export const putNoteWithFiles = (
  note: StoredNote,
  files: { path: string; blob: Blob }[],
) =>
  transaction(["notes", "files"], "readwrite", (tx) => {
    for (const file of files)
      tx.objectStore("files").put(file.blob, [note.scope, file.path]);
    return tx.objectStore("notes").put(note);
  });
export async function markSynced(
  scope: string,
  id: string,
  revision: string,
  sha: string,
) {
  return transaction(["notes"], "readwrite", (tx) => {
    const store = tx.objectStore("notes");
    const request = store.get([scope, id]);
    request.onsuccess = () => {
      const latest = request.result as StoredNote | undefined;
      if (latest)
        store.put({ ...latest, syncedRevision: revision, remoteSha: sha });
    };
    return request;
  });
}
// Compare-and-swap prevents a network response from overwriting an edit made while it was in flight.
export async function acceptRemote(
  incoming: StoredNote,
  expectedRevision: string | undefined,
  conflictCopy?: StoredNote,
): Promise<boolean> {
  let accepted = false;
  await transaction(["notes"], "readwrite", (tx) => {
    const store = tx.objectStore("notes");
    const request = store.get([incoming.scope, incoming.id]);
    request.onsuccess = () => {
      if (request.result?.revision === expectedRevision) {
        if (conflictCopy) store.put(conflictCopy);
        store.put(incoming);
        accepted = true;
      }
    };
    return request;
  });
  return accepted;
}

export async function putBackup(
  notes: StoredNote[],
  files: { scope: string; path: string; blob: Blob }[],
) {
  if (!notes.length) return;
  return transaction(["notes", "files"], "readwrite", (tx) => {
    for (const file of files)
      tx.objectStore("files").put(file.blob, [file.scope, file.path]);
    for (const note of notes.slice(0, -1)) tx.objectStore("notes").put(note);
    return tx.objectStore("notes").put(notes[notes.length - 1]);
  });
}
