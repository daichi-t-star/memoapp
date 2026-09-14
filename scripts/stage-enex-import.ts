/** Stage converted backups in a local notes checkout; never commits or uploads. */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { validateNote, notePath } from "../src/v2/model.ts";

process.umask(0o077);
const [batchPath, checkoutPath] = process.argv
  .slice(2)
  .map((value) => resolve(value));
if (!batchPath || !checkoutPath)
  throw new Error("Usage: stage-enex-import.ts BATCH_DIRECTORY NOTES_CHECKOUT");
const origin = execFileSync(
  "git",
  ["-C", checkoutPath, "remote", "get-url", "origin"],
  { encoding: "utf8" },
).trim();
if (!/github\.com[:/]daichi-t-star\/notes(?:\.git)?$/.test(origin))
  throw new Error(
    "This migration is restricted to the existing private notes repository",
  );
const noteDirectory = join(checkoutPath, ".memoapp/notes");
await mkdir(noteDirectory, { recursive: true });
const imported = new Set<string>();
for (const file of await readdir(noteDirectory)) {
  if (!file.endsWith(".json")) continue;
  const note = JSON.parse(await readFile(join(noteDirectory, file), "utf8"));
  if (note.importKey) imported.add(note.importKey);
}
const rows = JSON.parse(
  await readFile(join(batchPath, "batch-report.json"), "utf8"),
);
const result = {
  notes: 0,
  skipped: 0,
  files: 0,
  bytes: 0,
  folders: {} as Record<string, number>,
  paths: [] as string[],
};
async function create(path: string, bytes: Buffer) {
  const destination = join(checkoutPath, path);
  if (!destination.startsWith(checkoutPath + "/.memoapp/"))
    throw new Error("Invalid destination");
  try {
    await stat(destination);
    const existing = await readFile(destination);
    if (!existing.equals(bytes))
      throw new Error(`Refusing to overwrite existing path: ${path}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
  // Verify the actual staged filesystem bytes, including large binary attachments.
  const saved = await readFile(destination);
  if (!saved.equals(bytes)) throw new Error("Filesystem verification failed");
  result.paths.push(path);
}
for (const row of rows) {
  if (row.error)
    throw new Error("Resolve all conversion errors before staging");
  const root = resolve(row.directory),
    report = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
  for (const item of report.backups) {
    const source = await readFile(join(root, "backups", item.name));
    if (createHash("sha256").update(source).digest("hex") !== item.sha256)
      throw new Error("Backup checksum differs from verification report");
    const backup = JSON.parse(source.toString("utf8"));
    const files = new Map<string, any>(
      backup.files.map((f: any) => [f.path, f]),
    );
    for (const input of backup.notes) {
      const note = validateNote(input);
      if (!note.importKey || !note.folder.startsWith("Evernote／"))
        throw new Error("Missing migration identity or notebook folder");
      if (imported.has(note.importKey)) {
        result.skipped++;
        continue;
      }
      for (const a of note.attachments) {
        if (a.external) continue;
        const file = files.get(a.path);
        if (!file) throw new Error("Missing attachment");
        const bytes = Buffer.from(file.data, "base64");
        if (bytes.length !== a.size)
          throw new Error("Attachment size mismatch");
        await create(a.path, bytes);
        result.files++;
        result.bytes += bytes.length;
      }
      await create(notePath(note.id), Buffer.from(JSON.stringify(note)));
      imported.add(note.importKey);
      result.notes++;
      result.folders[note.folder] = (result.folders[note.folder] || 0) + 1;
    }
  }
}
await writeFile(
  join(batchPath, "staging-report.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, paths: result.paths.length }, null, 2));
