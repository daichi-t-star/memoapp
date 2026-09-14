import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { convertHtml } from "../scripts/convert-enex.ts";
import {
  contentText,
  plainContent,
  validateContent,
  richSchema,
} from "../src/v2/richtext.ts";
import { importBackup, buildBackup } from "../src/v2/backup.ts";
import { newNote, portable, validateNote } from "../src/v2/model.ts";
import { NoteStore } from "../src/v2/store.ts";
import * as db from "../src/v2/db.ts";

const sampleHtml =
  '<div><h2>日本語の見出し</h2><div style="color:rgb(200, 0, 0);font-size:24px"><strong>太字</strong>と色</div><div><input type="checkbox" checked="checked">完了</div><table><tr><th>項目</th><th>数</th></tr><tr><td>りんご</td><td>2</td></tr></table><div>前<img data-attachment-id="photo" width="40%">後<span data-file-id="file" data-attachment-id="file">資料.pdf</span></div><a href="https://example.com">リンク</a></div>';
const attachments = [
  {
    id: "photo",
    name: "画像.png",
    type: "image/png",
    size: 3,
    path: "assets/photo",
  },
  {
    id: "file",
    name: "資料.pdf",
    type: "application/pdf",
    size: 4,
    path: "assets/file",
  },
];
function fixture() {
  const rich = convertHtml(sampleHtml);
  return validateNote({
    ...portable(newNote("test")),
    version: 3,
    title: "移行テスト",
    ...rich,
    attachments,
    createdAt: "2010-09-06T13:36:41.000Z",
    updatedAt: "2026-05-14T10:22:55.000Z",
    tags: ["日本語", "資料"],
    folder: "Evernote／テスト",
    importKey: "enex:synthetic:0",
  });
}
const file = () =>
  new File(
    [
      JSON.stringify({
        format: "memoapp-backup",
        version: 3,
        notes: [fixture()],
        files: [
          {
            path: "assets/photo",
            type: "image/png",
            data: Buffer.from([0, 128, 255]).toString("base64"),
          },
          {
            path: "assets/file",
            type: "application/pdf",
            data: Buffer.from("PDF!").toString("base64"),
          },
        ],
      }),
    ],
    "fixture.json",
  );

test("legacy plain text remains literal, including markup, whitespace and empty lines", () => {
  const text = "<b>not HTML</b>\n**not markdown**\n\n  日本語\n";
  assert.equal(contentText(plainContent(text)), text);
});
test("ENML-derived HTML keeps editable heading, styles, table, tasks, inline image and file", () => {
  const n = fixture(),
    types: string[] = [],
    marks: string[] = [];
  richSchema.nodeFromJSON(n.content).descendants((node) => {
    types.push(node.type.name);
    marks.push(...node.marks.map((m) => m.type.name));
  });
  for (const t of [
    "heading",
    "table",
    "tableHeader",
    "tableCell",
    "inlineCheckbox",
    "image",
    "fileAttachment",
  ])
    assert.ok(types.includes(t), t);
  for (const m of ["bold", "textStyle", "link"])
    assert.ok(marks.includes(m), m);
  assert.match(n.text, /太字と色/);
  assert.match(n.text, /☑完了/);
  assert.match(n.text, /りんご/);
  assert.match(JSON.stringify(n.content), /24px/);
});
test("rich backup remaps inline and original attachment refs, preserves dates and skips repeat import", async () => {
  const scope = crypto.randomUUID(),
    original = fixture();
  assert.equal(await importBackup(file(), scope), 1);
  const n = (await db.allNotes(scope))[0];
  assert.equal(n.createdAt, original.createdAt);
  assert.equal(n.updatedAt, original.updatedAt);
  assert.deepEqual(n.tags, original.tags);
  assert.equal(n.folder, original.folder);
  assert.notEqual(n.attachments[0].id, "photo");
  assert.match(n.sourceHtml!, new RegExp(n.attachments[0].id));
  assert.doesNotThrow(() => validateNote(n));
  assert.deepEqual(
    new Uint8Array(
      await (await db.getBlob(scope, n.attachments[0].path))!.arrayBuffer(),
    ),
    new Uint8Array([0, 128, 255]),
  );
  assert.equal(await importBackup(file(), scope), 0);
  assert.equal((await db.allNotes(scope)).length, 1);
  const store = new NoteStore(scope);
  await store.refresh();
  await store.update(n.id, { content: plainContent("日本語で編集\n再読込") });
  await store.flush();
  const reopened = (await db.allNotes(scope))[0];
  assert.equal(reopened.version, 3);
  assert.equal(reopened.text, "日本語で編集\n再読込");
  assert.equal(reopened.sourceHtml, n.sourceHtml);
  assert.equal(reopened.attachments.length, 2);
  const id = await store.duplicate(n.id);
  const copy = await db.getNote(scope, id!);
  assert.equal(copy!.importKey, undefined);
  assert.deepEqual(copy!.content, reopened.content);
});
test("invalid refs, unsafe links and corrupt attachment bytes fail before restore writes", async () => {
  assert.throws(
    () =>
      validateContent(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "image", attrs: { attachmentId: "missing" } }],
            },
          ],
        },
        new Set(),
      ),
    /不足/,
  );
  assert.throws(
    () =>
      validateContent(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "x",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        },
        new Set(),
      ),
    /URL/,
  );
  const data = JSON.parse(await file().text());
  data.files[0].data = "AA==";
  const scope = crypto.randomUUID();
  await assert.rejects(
    importBackup(new File([JSON.stringify(data)], "bad.json"), scope),
    /不足/,
  );
  assert.equal((await db.allNotes(scope)).length, 0);
});
test("imported and pasted hostile HTML cannot execute scripts or load remote CSS", () => {
  const rich = convertHtml(
    '<div onclick="alert(1)" style="color:red;position:fixed;background-image:url(https://example.com)">安全<a href="javascript:alert(1)">リンク</a><script>alert(1)</script></div>',
  );
  assert.equal(rich.text, "安全リンク");
  assert.doesNotMatch(
    rich.sourceHtml,
    /onclick|javascript|position:fixed|url\(/,
  );
});

test("streamed backup roundtrips rich notes and rejects a truncated final record atomically", async () => {
  const source = crypto.randomUUID();
  await importBackup(file(), source);
  const blob = await buildBackup(source, await db.allNotes(source));
  const destination = crypto.randomUUID();
  assert.equal(
    await importBackup(new File([blob], "backup.jsonl"), destination),
    1,
  );
  const n = (await db.allNotes(destination))[0];
  assert.equal(n.version, 3);
  assert.equal(n.attachments.length, 2);
  assert.doesNotThrow(() => validateNote(n));
  const rows = (await blob.text()).trimEnd().split("\n");
  rows.pop();
  const bad = crypto.randomUUID();
  await assert.rejects(
    importBackup(new File([rows.join("\n") + "\n"], "truncated.jsonl"), bad),
    /途中で切れた/,
  );
  assert.equal((await db.allNotes(bad)).length, 0);
});

test("streamed backup handles UTF-8 and base64 records spanning many stream chunks", async () => {
  const s = crypto.randomUUID(),
    n = newNote(s),
    bytes = Uint8Array.from({ length: 280001 }, (_, i) => i % 256);
  n.text = "日本語の長いメモ".repeat(8000);
  n.attachments = [
    {
      id: "binary",
      name: "large.bin",
      path: "data/large",
      type: "application/octet-stream",
      size: bytes.length,
    },
  ];
  await db.putNoteWithFiles(n, [
    { path: "data/large", blob: new Blob([bytes]) },
  ]);
  const blob = await buildBackup(s, [n]),
    dest = crypto.randomUUID();
  assert.equal(await importBackup(new File([blob], "large.jsonl"), dest), 1);
  const restored = (await db.allNotes(dest))[0];
  assert.equal(restored.text, n.text);
  assert.deepEqual(
    new Uint8Array(
      await (await db.getBlob(
        dest,
        restored.attachments[0].path,
      ))!.arrayBuffer(),
    ),
    bytes,
  );
});
