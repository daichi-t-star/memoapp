// Manual live integration test, authorized by the user on 2026-09-06.
// Only synthetic fixtures are published, on a temporary branch of the app repository.
// Never accesses the personal notes repository.
import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Remote, synchronize } from "../src/v2/remote.ts";
import { NoteStore } from "../src/v2/store.ts";
import { isPending, notePath } from "../src/v2/model.ts";
import { getNote, allNotes } from "../src/v2/db.ts";

const token = execFileSync("gh", ["auth", "token"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const branch = `codex/memoapp-v2-verification-${Date.now()}`;
const remote = new Remote(token, {
  owner: "daichi-t-star",
  repo: "memoapp",
  branch,
});
const base = await remote.request<{ object: { sha: string } }>(
  `${remote.base()}/git/ref/heads/main`,
);
let created = false;
try {
  await remote.request(`${remote.base()}/git/refs`, "POST", {
    ref: `refs/heads/${branch}`,
    sha: base.object.sha,
  });
  created = true;
  console.log(`Temporary test branch: ${branch}`);
  const original = await remote.tree();
  const scope = `test:${branch}`;
  const store = new NoteStore(scope);
  await store.refresh();
  const id = await store.create("", {
    title: "MemoApp integration verification",
    text: "日本語と改行\nの保存確認（テスト専用）",
  });
  const image = readFileSync(
    new URL("./fixtures/添付テスト 画像.png", import.meta.url),
  );
  await store.attach(id, [
    new File([image], "日本語 写真.png", { type: "image/png" }),
    new File([new Uint8Array(1100000).fill(42)], "large-test.bin", {
      type: "application/octet-stream",
    }),
  ]);
  await synchronize(
    remote,
    scope,
    () => {},
    async () => {},
  );
  const saved = (await getNote(scope, id))!;
  assert.equal(isPending(saved), false);
  const cloud = JSON.parse(await (await remote.blob(notePath(id))).text());
  assert.equal(cloud.text, "日本語と改行\nの保存確認（テスト専用）");
  assert.equal(cloud.attachments.length, 2);
  assert.deepEqual(
    new Uint8Array(
      await (await remote.blob(cloud.attachments[0].path)).arrayBuffer(),
    ),
    new Uint8Array(image),
  );
  const binary = new Uint8Array(
    await (await remote.blob(cloud.attachments[1].path)).arrayBuffer(),
  );
  assert.equal(binary.length, 1100000);
  assert.ok(binary.every((x) => x === 42));
  console.log(
    "PASS: atomic note/attachments, Japanese filename, image byte equality, 1.1 MB raw binary download.",
  );
  const secondScope = `${scope}:device2`;
  await synchronize(
    remote,
    secondScope,
    () => {},
    async () => {},
  );
  assert.equal((await getNote(secondScope, id))!.text, cloud.text);
  let downloads = 0;
  const download = remote.blob.bind(remote);
  remote.blob = async (...args) => {
    downloads++;
    return download(...args);
  };
  await synchronize(
    remote,
    secondScope,
    () => {},
    async () => {},
  );
  assert.equal(downloads, 0);
  console.log(
    "PASS: second device retrieval and zero unchanged-content requests.",
  );
  await store.refresh();
  const second = new NoteStore(secondScope);
  await second.refresh();
  await store.update(id, { text: "Device one synthetic edit" });
  await second.update(id, { text: "Device two synthetic edit" });
  await synchronize(
    remote,
    scope,
    () => {},
    async () => {},
  );
  await synchronize(
    remote,
    secondScope,
    () => {},
    async () => {},
  );
  const variants = (await allNotes(secondScope)).filter(
    (n) => n.id === id || n.title.includes("この端末の変更"),
  );
  assert.deepEqual(variants.map((n) => n.text).sort(), [
    "Device one synthetic edit",
    "Device two synthetic edit",
  ]);
  const after = await remote.tree();
  for (const f of original.tree)
    assert.equal(
      after.tree.find((x) => x.path === f.path)?.sha,
      f.sha,
      `Original file changed: ${f.path}`,
    );
  console.log(
    "PASS: concurrent device changes both retained; original repository files unchanged.",
  );
} finally {
  if (created) {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "DELETE",
        `repos/daichi-t-star/memoapp/git/refs/heads/${branch}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log("Temporary test branch removed.");
  }
}
