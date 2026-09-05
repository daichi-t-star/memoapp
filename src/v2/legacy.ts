import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseFrontmatter } from "../lib/frontmatter";
import { mimeFor, newNote, type Attachment, type StoredNote } from "./model";

interface Node {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  identifier?: string;
  checked?: boolean;
  ordered?: boolean;
  children?: Node[];
}
export async function importLegacy(
  content: string,
  path: string,
  sha: string,
  scope: string,
): Promise<StoredNote> {
  const { data, body } = parseFrontmatter(content);
  // Older notes sometimes contain unescaped spaces in image paths.
  const normalizedBody = body.replace(
    /!\[([^\]]*)\]\(([^<>\n]*\s[^<>\n]*)\)/g,
    (original, alt: string, target: string) => {
      const path = target.trim();
      return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path)
        ? `![${alt}](<${path}>)`
        : original;
    },
  );
  const root = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(normalizedBody) as Node;
  const attachments: Attachment[] = [];
  const definitions = new Map<string, string>();
  function collect(n: Node) {
    if (n.type === "definition" && n.identifier && n.url)
      definitions.set(n.identifier, n.url);
    n.children?.forEach(collect);
  }
  collect(root);
  function attachment(url: string, name: string) {
    if (!url || /^(?!https?:)[a-z][a-z\d+.-]*:/i.test(url)) return;
    let resolved = url;
    const external = /^https?:\/\//i.test(url);
    if (!external) {
      try {
        resolved = decodeURIComponent(url);
      } catch {
        /* keep original path */
      }
      const segments = (
        resolved.startsWith("/")
          ? resolved.slice(1)
          : `${path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : ""}${resolved}`
      ).split("/");
      const parts: string[] = [];
      for (const part of segments) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
      }
      resolved = parts.join("/");
    }
    if (!attachments.some((a) => a.path === resolved))
      attachments.push({
        id: crypto.randomUUID(),
        name: name || resolved.split("/").pop() || "画像",
        path: resolved,
        external,
        type: mimeFor(resolved),
        size: 0,
      });
  }
  function plain(n: Node): string {
    const children = () => (n.children || []).map(plain).join("");
    switch (n.type) {
      case "definition":
        return "";
      case "image":
      case "imageReference":
        attachment(
          n.url || definitions.get(n.identifier || "") || "",
          n.alt || "",
        );
        return "";
      case "link":
      case "linkReference": {
        const url = n.url || definitions.get(n.identifier || "") || "";
        const label = children();
        if (url && !/^(https?:|mailto:|#)/i.test(url)) attachment(url, label);
        return label === url || !url ? label : `${label} (${url})`;
      }
      case "listItem":
        return `${typeof n.checked === "boolean" ? (n.checked ? "☑ " : "☐ ") : "・"}${children().trim()}\n`;
      case "tableRow":
        return (n.children || []).map(plain).join("　|　") + "\n";
      case "paragraph":
      case "heading":
      case "blockquote":
      case "list":
      case "table":
        return children().trim() + "\n\n";
      case "code":
        return (n.value || "") + "\n\n";
      case "break":
        return "\n";
      case "thematicBreak":
        return "\n";
      case "html":
        return n.value || ""; // Never execute legacy HTML.
      default:
        return n.value ?? children();
    }
  }
  const text = plain(root)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path),
  );
  const id =
    "legacy-" +
    Array.from(new Uint8Array(digest))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  return {
    ...newNote(scope),
    id,
    title:
      typeof data.title === "string"
        ? data.title.replace(/^['"]|['"]$/g, "")
        : path.split("/").pop()!.replace(/\.md$/i, ""),
    text,
    tags: Array.isArray(data.tags) ? data.tags : [],
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    sourcePath: path,
    legacySha: sha,
    attachments,
    revision: sha,
    syncedRevision: sha,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}
