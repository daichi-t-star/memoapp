import test from "node:test";
import assert from "node:assert/strict";
import { folderGroups } from "../src/v2/folders.ts";

test("folder hierarchy keeps exact paths and counts across both slash styles", () => {
  const folders = [
    "Evernote／食",
    "memo/金融・税務",
    "Evernote／旅行",
    "memo/仕事/資料",
    "AI",
  ];
  const counts = new Map(folders.map((path, i) => [path, i + 1]));
  const groups = folderGroups([...folders, folders[0]], counts);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["AI", "memo", "Evernote"],
  );
  assert.equal(groups.at(-1)?.backup, true);
  assert.equal(groups.at(-1)?.count, 4);
  const memo = groups.find((group) => group.name === "memo")!;
  assert.equal(memo.count, 6);
  assert.ok(
    memo.items.some(
      (item) => item.label === "仕事/資料" && item.path === "memo/仕事/資料",
    ),
  );
  assert.deepEqual(
    groups.flatMap((group) => group.items.map((item) => item.path)).sort(),
    folders.sort(),
  );
});

test("a parent containing its own notes remains accessible alongside children", () => {
  const [group] = folderGroups(
    ["memo", "memo/旅行", "memo/空のフォルダ"],
    new Map([
      ["memo", 2],
      ["memo/旅行", 3],
    ]),
  );
  assert.equal(group.grouped, true);
  assert.equal(group.count, 5);
  assert.deepEqual(
    group.items.find((item) => item.path === "memo"),
    { path: "memo", label: "直下のメモ", count: 2 },
  );
  assert.equal(
    group.items.find((item) => item.path === "memo/空のフォルダ")?.count,
    0,
  );
});

test("plain folders and incomplete path separators do not acquire artificial children", () => {
  const groups = folderGroups(["AI", "/先頭", "末尾／"], new Map());
  assert.ok(
    groups.every((group) => !group.grouped && group.items.length === 1),
  );
});
