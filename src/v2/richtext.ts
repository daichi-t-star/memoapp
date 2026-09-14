import {
  Extension,
  Node,
  getSchema,
  mergeAttributes,
  type JSONContent,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";

export type RichContent = JSONContent;
export const safeLink = (url: unknown) =>
  typeof url === "string" &&
  /^(https?:\/\/|mailto:|tel:|evernote:\/\/\/|#)/i.test(url.trim()) &&
  !/[\u0000-\u001f]/.test(url);
export const safeImage = (url: unknown) =>
  typeof url === "string" &&
  /^https?:\/\//i.test(url) &&
  !/[\u0000-\u001f]/.test(url);

// Preserve ordinary document styling, never executable CSS, remote CSS assets or overlays.
const properties =
  /^(color|background-color|font-family|font-size|font-weight|font-style|text-align|text-decoration|line-height|vertical-align|white-space|width|height|max-width|border(-color|-width|-style|-collapse|-spacing)?|padding(-left|-right|-top|-bottom)?|margin(-left|-right|-top|-bottom)?|list-style-type)$/;
export function safeStyle(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .split(";")
    .flatMap((part) => {
      const at = part.indexOf(":");
      if (at < 0) return [];
      const key = part.slice(0, at).trim().toLowerCase(),
        value = part.slice(at + 1).trim();
      return properties.test(key) &&
        value.length < 250 &&
        !/url|expression|javascript|[<>\\{}@]/i.test(value)
        ? [`${key}:${value}`]
        : [];
    })
    .join(";");
}
const DocumentStyle = Extension.create({
  name: "documentStyle",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "table",
          "tableCell",
          "tableHeader",
          "listItem",
          "taskItem",
        ],
        attributes: {
          documentStyle: {
            default: null,
            parseHTML: (e) => safeStyle(e.getAttribute("style")),
            renderHTML: (a) =>
              safeStyle(a.documentStyle)
                ? { style: safeStyle(a.documentStyle) }
                : {},
          },
        },
      },
    ];
  },
});
export const MemoImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-attachment-id"),
        renderHTML: (a) =>
          a.attachmentId ? { "data-attachment-id": a.attachmentId } : {},
      },
      src: {
        default: null,
        parseHTML: (e) =>
          safeImage(e.getAttribute("src")) ? e.getAttribute("src") : null,
        renderHTML: (a) => (safeImage(a.src) ? { src: a.src } : {}),
      },
      alt: { default: "" },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (e) => e.getAttribute("width") || e.style.width,
      },
      height: {
        default: null,
        parseHTML: (e) => e.getAttribute("height") || e.style.height,
      },
    };
  },
  parseHTML() {
    return [{ tag: "img" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        loading: "lazy",
        referrerpolicy: "no-referrer",
      }),
    ];
  },
});
export const MemoFile = Node.create({
  name: "fileAttachment",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-file-id"),
        renderHTML: (a) => ({ "data-file-id": a.attachmentId }),
      },
      name: { default: "添付ファイル", parseHTML: (e) => e.textContent },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-file-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "rich-file" }),
      String(HTMLAttributes.name || "添付ファイル"),
    ];
  },
});
export const InlineCheckbox = Node.create({
  name: "inlineCheckbox",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (e) => e.hasAttribute("checked"),
        renderHTML: (a) => (a.checked ? { checked: "checked" } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'input[type="checkbox"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["input", { ...HTMLAttributes, type: "checkbox" }];
  },
});
export function richExtensions(
  images = MemoImage,
  files = MemoFile,
  checkbox = InlineCheckbox,
) {
  return [
    StarterKit.configure({
      trailingNode: false,
      link: { openOnClick: false, isAllowedUri: safeLink },
    }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    DocumentStyle,
    images,
    files,
    checkbox,
  ];
}
export const richSchema = getSchema(richExtensions());
export function plainContent(text: string): RichContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}
export function contentText(doc: RichContent): string {
  const node = richSchema.nodeFromJSON(doc);
  return node.textBetween(0, node.content.size, "\n", (leaf) =>
    leaf.type.name === "inlineCheckbox"
      ? leaf.attrs.checked
        ? "☑"
        : "☐"
      : leaf.type.name === "fileAttachment"
        ? leaf.attrs.name
        : leaf.attrs.alt || "",
  );
}
export function validateContent(
  value: unknown,
  attachmentIds: Set<string>,
): RichContent {
  const doc = value as RichContent;
  let count = 0;
  const visit = (n: RichContent, depth: number) => {
    if (
      !n ||
      typeof n !== "object" ||
      depth > 100 ||
      ++count > 200000 ||
      typeof n.type !== "string"
    )
      throw new Error("書式付き本文の形式が正しくありません。");
    if (
      (n.type === "image" || n.type === "fileAttachment") &&
      n.attrs?.attachmentId &&
      !attachmentIds.has(n.attrs.attachmentId)
    )
      throw new Error("本文が参照する添付ファイルが不足しています。");
    if (n.type === "image" && n.attrs?.src && !safeImage(n.attrs.src))
      throw new Error("画像のURLが正しくありません。");
    for (const mark of n.marks || [])
      if (mark.type === "link" && !safeLink(mark.attrs?.href))
        throw new Error("リンクのURLが正しくありません。");
    for (const child of n.content || []) visit(child, depth + 1);
  };
  visit(doc, 0);
  if (doc.type !== "doc")
    throw new Error("書式付き本文の形式が正しくありません。");
  const node = richSchema.nodeFromJSON(doc);
  node.check();
  return node.toJSON();
}
export function remapContent(
  doc: RichContent | undefined,
  ids: Map<string, string>,
): RichContent | undefined {
  if (!doc) return undefined;
  return {
    ...doc,
    ...(doc.attrs
      ? {
          attrs: {
            ...doc.attrs,
            ...(doc.attrs.attachmentId
              ? {
                  attachmentId:
                    ids.get(doc.attrs.attachmentId) || doc.attrs.attachmentId,
                }
              : {}),
          },
        }
      : {}),
    ...(doc.content
      ? { content: doc.content.map((n) => remapContent(n, ids)!) }
      : {}),
  };
}
