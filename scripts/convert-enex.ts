/** One-time offline conversion into ordinary MemoApp backup files. Never bundled. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import {
  richSchema,
  safeStyle,
  safeLink,
  safeImage,
  contentText,
} from "../src/v2/richtext.ts";
import { validateNote, type Note } from "../src/v2/model.ts";

const window = new JSDOM("").window;
const purify = createDOMPurify(window as any);
const parser = ProseMirrorParser.fromSchema(richSchema);
const compact = (text: string) => text.replace(/[\s\u200b\ufeff]/gu, "");
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function convertHtml(html: string) {
  const doc = new window.DOMParser().parseFromString(
    purify.sanitize(html, {
      ADD_TAGS: ["input"],
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["id"],
    }),
    "text/html",
  );
  for (const el of doc.querySelectorAll<HTMLElement>("[style]"))
    el.setAttribute("style", safeStyle(el.getAttribute("style")));
  for (const el of doc.querySelectorAll("a"))
    if (!safeLink(el.getAttribute("href"))) el.removeAttribute("href");
  for (const el of doc.querySelectorAll("img[src]"))
    if (!safeImage(el.getAttribute("src"))) el.removeAttribute("src");
  const sourceHtml = doc.body.innerHTML;
  // ENML uses divs for paragraphs and font tags in older exports.
  for (const el of [...doc.querySelectorAll("font")]) {
    const span = doc.createElement("span");
    span.style.color = el.getAttribute("color") || "";
    span.style.fontFamily = el.getAttribute("face") || "";
    const sizes = ["", "10px", "13px", "16px", "18px", "24px", "32px", "48px"];
    span.style.fontSize = sizes[Number(el.getAttribute("size"))] || "";
    span.style.cssText += safeStyle(el.getAttribute("style"));
    span.append(...el.childNodes);
    el.replaceWith(span);
  }
  const blocks =
    "p,div,h1,h2,h3,h4,h5,h6,table,ul,ol,li,blockquote,pre,dl,dt,dd,hr";
  // Carry inherited typography into inline spans before block containers are normalized.
  for (const el of [
    ...doc.querySelectorAll<HTMLElement>(
      "div[style],p[style],td[style],th[style]",
    ),
  ].reverse()) {
    const css = [
      "color",
      "background-color",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "text-decoration",
      "line-height",
    ]
      .map((key) =>
        el.style.getPropertyValue(key)
          ? `${key}:${el.style.getPropertyValue(key)}`
          : "",
      )
      .filter(Boolean)
      .join(";");
    if (!css) continue;
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 1 && (child as Element).matches(blocks)) continue;
      const span = doc.createElement("span");
      span.setAttribute("style", css);
      child.replaceWith(span);
      span.append(child);
    }
  }
  for (const el of [...doc.querySelectorAll("div,dt,dd")].reverse()) {
    if (el.querySelector(blocks)) continue;
    const paragraph = doc.createElement("p");
    paragraph.setAttribute("style", safeStyle(el.getAttribute("style")));
    paragraph.append(...el.childNodes);
    el.replaceWith(paragraph);
  }
  // Unknown ENML wrappers are read as ordinary blocks; preserve all visible text.
  const content = parser.parse(doc.body, { preserveWhitespace: true }).toJSON();
  const text = contentText(content);
  const originalText = doc.body.textContent || "";
  const actualText = richSchema
    .nodeFromJSON(content)
    .textBetween(
      0,
      richSchema.nodeFromJSON(content).content.size,
      "",
      (leaf) => (leaf.type.name === "fileAttachment" ? leaf.attrs.name : ""),
    );
  if (compact(originalText) !== compact(actualText))
    throw new Error("Visible text differs after rich text conversion");
  const count = (type: string) => {
    let n = 0;
    richSchema.nodeFromJSON(content).descendants((node) => {
      if (node.type.name === type) n++;
    });
    return n;
  };
  if (
    count("image") !== doc.querySelectorAll("img").length ||
    count("inlineCheckbox") !==
      doc.querySelectorAll('input[type="checkbox"]').length ||
    count("table") !== doc.querySelectorAll("table").length
  )
    throw new Error("Image, checkbox or table count differs after conversion");
  return {
    content,
    text,
    sourceHtml,
    externalImages: doc.querySelectorAll("img[src]").length,
    unavailableImages: doc.querySelectorAll(
      "img:not([src]):not([data-attachment-id])",
    ).length,
    evernoteLinks: doc.querySelectorAll('a[href^="evernote:"]').length,
  };
}

function iso(date: string) {
  if (!/^\d{8}T\d{6}Z$/.test(date))
    throw new Error("Missing or invalid Evernote date");
  return new Date(
    date.replace(
      /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
      "$1-$2-$3T$4:$5:$6Z",
    ),
  ).toISOString();
}
export async function convert(directory: string) {
  process.umask(0o077);
  const root = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  const output = join(root, "backups");
  await mkdir(output, { recursive: true });
  const report = {
    sourceSha256: manifest.sourceSha256,
    notebook: manifest.notebook,
    notes: 0,
    resources: 0,
    bytes: 0,
    externalImages: 0,
    evernoteLinks: 0,
    warnings: [] as any[],
    backups: [] as any[],
  };
  let notes: Note[] = [],
    files: any[] = [],
    size = 0;
  const occurrences = new Map<string, number>();
  async function flush() {
    if (!notes.length) return;
    const name = `memoapp-${manifest.notebook.normalize("NFC")}-${String(report.backups.length + 1).padStart(3, "0")}.json`;
    const json = JSON.stringify({
      format: "memoapp-backup",
      version: 3,
      notes,
      files,
      exportedAt: new Date().toISOString(),
    });
    await writeFile(join(output, name), json, { mode: 0o600 });
    report.backups.push({
      name,
      notes: notes.length,
      resources: files.length,
      bytes: Buffer.byteLength(json),
      sha256: hash(json),
    });
    notes = [];
    files = [];
    size = 0;
  }
  for (const name of manifest.notes) {
    const source = JSON.parse(await readFile(join(root, name), "utf8"));
    let rich: ReturnType<typeof convertHtml>;
    try {
      rich = convertHtml(source.html);
    } catch (e) {
      throw new Error(`Note ${source.index}: ${(e as Error).message}`);
    }
    const key = hash(
      JSON.stringify([
        manifest.notebook.normalize("NFC"),
        source.created,
        source.title,
      ]),
    );
    const ordinal = occurrences.get(key) || 0;
    occurrences.set(key, ordinal + 1);
    const importKey = `enex:${key}:${ordinal}`;
    const attachments = source.attachments.map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      size: a.size,
      path: `.memoapp/attachments/${hash(importKey).slice(0, 32)}/${a.id}`,
    }));
    const note = validateNote({
      version: 3,
      id: hash(importKey),
      title: source.title,
      folder: `Evernote／${manifest.notebook.normalize("NFC")}`,
      tags: source.tags,
      pinned: false,
      archived: false,
      deleted: false,
      createdAt: iso(source.created),
      updatedAt: iso(source.updated || source.created),
      attachments,
      content: rich.content,
      text: rich.text,
      sourceHtml: rich.sourceHtml,
      importKey,
    });
    const noteSize =
      Buffer.byteLength(JSON.stringify(note)) +
      source.attachments.reduce((n: number, a: any) => n + (a.size * 4) / 3, 0);
    if (
      notes.length &&
      (size + noteSize > 24 * 1024 * 1024 || notes.length >= 50)
    )
      await flush();
    for (const [i, a] of source.attachments.entries()) {
      const bytes = await readFile(join(root, "resources", a.sha256));
      if (bytes.length !== a.size || hash(bytes) !== a.sha256)
        throw new Error(`Resource integrity failure: note ${source.index}`);
      files.push({
        path: attachments[i].path,
        type: a.type,
        data: bytes.toString("base64"),
      });
      report.resources++;
      report.bytes += bytes.length;
    }
    notes.push(note);
    size += noteSize;
    report.notes++;
    report.externalImages += rich.externalImages;
    report.evernoteLinks += rich.evernoteLinks;
    if (source.warnings.length || rich.unavailableImages)
      report.warnings.push({
        index: source.index,
        warnings: source.warnings,
        unavailableImages: rich.unavailableImages,
      });
  }
  await flush();
  if (
    report.notes !== manifest.notes.length ||
    report.resources !== manifest.resources ||
    report.bytes !== manifest.bytes
  )
    throw new Error("Export totals do not match");
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        ...report,
        warnings: report.warnings.length,
        backups: report.backups.map((b) => ({
          name: b.name,
          notes: b.notes,
          bytes: b.bytes,
        })),
      },
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await convert(process.argv[2]);
