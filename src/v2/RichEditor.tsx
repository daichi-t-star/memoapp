import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
  type Editor,
} from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Link,
  Table,
  Undo2,
  Redo2,
  ImagePlus,
  Paperclip,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Download,
  ImageOff,
} from "lucide-react";
import DOMPurify from "dompurify";
import {
  InlineCheckbox,
  MemoFile,
  MemoImage,
  plainContent,
  richExtensions,
  safeLink,
  safeImage,
  safeStyle,
  type RichContent,
} from "./richtext";
import { getBlob, putBlob } from "./db";
import type { Attachment, StoredNote } from "./model";
import type { Remote } from "./remote";
import { download } from "./backup";

type Assets = {
  note: StoredNote;
  scope: string;
  remote: Remote | null;
  pending: Map<string, Blob>;
};
const AssetContext = createContext<Assets>(null!);
function useAsset(id: string, externalSrc?: string) {
  const assets = useContext(AssetContext);
  const a = assets.note.attachments.find((a) => a.id === id);
  const pending = a && assets.pending.get(a.path);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false,
      objectUrl = "";
    setUrl("");
    setError("");
    if (!a || a.external) {
      const source = a?.path || externalSrc;
      if (safeImage(source)) setUrl(source!);
      else setError("画像のデータがありません");
      return;
    }
    (async () => {
      let blob = pending || (await getBlob(assets.scope, a.path));
      if (!blob && assets.remote) {
        blob = await assets.remote.blob(a.path);
        await putBlob(assets.scope, a.path, blob);
      }
      if (!blob)
        throw new Error("画像を取得できません。接続後に再試行してください。");
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([blob], { type: a.type }));
      setUrl(objectUrl);
    })().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    a?.path,
    a?.type,
    externalSrc,
    assets.scope,
    assets.remote,
    pending,
    retry,
  ]);
  return { a, url, error, retry: () => setRetry((n) => n + 1) };
}
const dimension = (v: unknown) =>
  typeof v === "number"
    ? `${Math.max(1, v)}px`
    : typeof v === "string" && /^\d+(\.\d+)?(px|%|em|rem)?$/.test(v)
      ? /^\d+$/.test(v)
        ? `${v}px`
        : v
      : undefined;
function ImageNode({
  node,
  selected,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const { a, url, error, retry } = useAsset(
    node.attrs.attachmentId,
    node.attrs.src,
  );
  return (
    <NodeViewWrapper
      as="span"
      className={`rich-image ${selected ? "selected" : ""}`}
      style={{ width: dimension(node.attrs.width), maxWidth: "100%" }}
      contentEditable={false}
    >
      {url ? (
        <img
          src={url}
          alt={node.attrs.alt || a?.name || "画像"}
          title={a?.name}
          style={{ width: "100%", height: "auto" }}
          draggable="true"
          data-drag-handle
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.alt =
              "画像を取得できません：" +
              (node.attrs.alt || a?.name || "外部画像");
          }}
        />
      ) : (
        <button type="button" onClick={retry}>
          <ImageOff size={16} />
          {error || "画像を読み込み中…"}
        </button>
      )}
      {selected && editor.isEditable && (
        <span className="image-sizes">
          {[25, 50, 100].map((size) => (
            <button
              type="button"
              key={size}
              onClick={() =>
                updateAttributes({ width: `${size}%`, height: null })
              }
            >
              {size}%
            </button>
          ))}
        </span>
      )}
    </NodeViewWrapper>
  );
}
function FileNode({ node }: NodeViewProps) {
  const assets = useContext(AssetContext);
  const a = assets.note.attachments.find(
    (a) => a.id === node.attrs.attachmentId,
  );
  const [error, setError] = useState("");
  async function save() {
    if (!a) return;
    try {
      if (a.external) {
        window.open(a.path, "_blank", "noopener,noreferrer");
        return;
      }
      const blob =
        assets.pending.get(a.path) ||
        (await getBlob(assets.scope, a.path)) ||
        (await assets.remote?.blob(a.path));
      if (!blob) throw new Error("取得には接続が必要です");
      await putBlob(assets.scope, a.path, blob);
      download(new Blob([blob], { type: a.type }), a.name);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <button
        type="button"
        className="rich-file"
        onClick={save}
        title={error || "ダウンロード"}
      >
        <Paperclip size={14} />
        {a?.name || node.attrs.name}
        <Download size={12} />
      </button>
      {error && <small role="status">{error}</small>}
    </NodeViewWrapper>
  );
}
function CheckboxNode({ node, updateAttributes, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="inline-checkbox"
    >
      <input
        type="checkbox"
        aria-label="チェック項目"
        checked={!!node.attrs.checked}
        disabled={!editor.isEditable}
        onChange={(e) => updateAttributes({ checked: e.target.checked })}
      />
    </NodeViewWrapper>
  );
}

export type RichEditorHandle = {
  insertAttachments: (files: Attachment[]) => void;
};
type Props = Assets & {
  onChange: (content: RichContent) => void;
  onFiles: (files: File[]) => Promise<Attachment[] | undefined>;
  onComposition: (active: boolean) => void;
  handle: React.RefObject<RichEditorHandle | null>;
  chooseImage: () => void;
  chooseFile: () => void;
};
export function RichEditor(props: Props) {
  const current = useRef(props);
  current.current = props;
  const lastSent = useRef(
    JSON.stringify(props.note.content || plainContent(props.note.text)),
  );
  const composing = useRef(false);
  const [linkEditor, setLinkEditor] = useState(false),
    [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  function insertAttachments(editor: Editor, files: Attachment[]) {
    if (editor.isDestroyed) return;
    editor
      .chain()
      .focus()
      .insertContent(
        files.map((a) =>
          /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(a.type)
            ? {
                type: "image",
                attrs: { attachmentId: a.id, alt: a.name, width: "100%" },
              }
            : {
                type: "fileAttachment",
                attrs: { attachmentId: a.id, name: a.name },
              },
        ),
      )
      .run();
  }
  async function receiveFiles(editor: Editor, files: File[]) {
    const added = await current.current.onFiles(files);
    if (added?.length) insertAttachments(editor, added);
  }
  const editor = useEditor({
    extensions: richExtensions(
      MemoImage.extend({ addNodeView: () => ReactNodeViewRenderer(ImageNode) }),
      MemoFile.extend({ addNodeView: () => ReactNodeViewRenderer(FileNode) }),
      InlineCheckbox.extend({
        addNodeView: () => ReactNodeViewRenderer(CheckboxNode),
      }),
    ),
    content: props.note.content || plainContent(props.note.text),
    editable: !props.note.deleted,
    editorProps: {
      attributes: {
        class: "rich-content",
        role: "textbox",
        "aria-label": "メモ本文",
        "aria-multiline": "true",
        "data-placeholder": "ここに、自由に書いてみましょう。",
      },
      transformPastedHTML: (html) =>
        DOMPurify.sanitize(html, {
          FORBID_TAGS: ["style", "iframe", "form"],
          FORBID_ATTR: ["id"],
        }),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        if (editor) void receiveFiles(editor, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files.length) return false;
        event.preventDefault();
        event.stopPropagation();
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (editor && position) editor.commands.setTextSelection(position.pos);
        if (editor)
          void receiveFiles(editor, Array.from(event.dataTransfer.files));
        return true;
      },
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true;
          current.current.onComposition(true);
          return false;
        },
        compositionend: () => {
          composing.current = false;
          current.current.onComposition(false);
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      const doc = editor.getJSON();
      lastSent.current = JSON.stringify(doc);
      current.current.onChange(doc);
    },
  });
  useEditorState({ editor, selector: ({ editor }) => editor?.state });
  useEffect(() => {
    if (!editor) return;
    props.handle.current = {
      insertAttachments: (files) => insertAttachments(editor, files),
    };
    return () => {
      props.handle.current = null;
      current.current.onComposition(false);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === props.note.deleted)
      editor.setEditable(!props.note.deleted, false);
    const incoming = props.note.content || plainContent(props.note.text),
      json = JSON.stringify(incoming);
    if (json !== lastSent.current && !composing.current) {
      editor.commands.setContent(incoming, { emitUpdate: false });
      lastSent.current = json;
    }
  }, [editor, props.note.content, props.note.text, props.note.deleted]);
  if (!editor) return null;
  const button = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <button
      type="button"
      key={label}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || props.note.deleted}
      className={active ? "active" : ""}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );
  return (
    <AssetContext.Provider value={props}>
      <div className="rich-editor">
        {!props.note.deleted && (
          <div
            className="rich-toolbar"
            role="toolbar"
            aria-label="文字と段落の書式"
          >
            <select
              aria-label="段落の種類"
              value={
                editor.isActive("heading")
                  ? String(editor.getAttributes("heading").level)
                  : "paragraph"
              }
              onChange={(e) =>
                e.target.value === "paragraph"
                  ? editor.chain().focus().setParagraph().run()
                  : editor
                      .chain()
                      .focus()
                      .toggleHeading({
                        level: Number(e.target.value) as 1 | 2 | 3,
                      })
                      .run()
              }
            >
              <option value="paragraph">本文</option>
              <option value="1">見出し1</option>
              <option value="2">見出し2</option>
              <option value="3">見出し3</option>
            </select>
            <select
              aria-label="文字サイズ"
              value={editor.getAttributes("textStyle").fontSize || ""}
              onChange={(e) =>
                e.target.value
                  ? editor.chain().focus().setFontSize(e.target.value).run()
                  : editor.chain().focus().unsetFontSize().run()
              }
            >
              <option value="">サイズ</option>
              {[12, 14, 16, 18, 20, 24, 32].map((n) => (
                <option key={n} value={`${n}px`}>
                  {n}
                </option>
              ))}
            </select>
            {button(
              "太字",
              <Bold size={16} />,
              () => editor.chain().focus().toggleBold().run(),
              editor.isActive("bold"),
            )}
            {button(
              "斜体",
              <Italic size={16} />,
              () => editor.chain().focus().toggleItalic().run(),
              editor.isActive("italic"),
            )}
            {button(
              "下線",
              <Underline size={16} />,
              () => editor.chain().focus().toggleUnderline().run(),
              editor.isActive("underline"),
            )}
            {button(
              "取り消し線",
              <Strikethrough size={16} />,
              () => editor.chain().focus().toggleStrike().run(),
              editor.isActive("strike"),
            )}
            <label className="text-color" title="文字色">
              <span>A</span>
              <input
                type="color"
                aria-label="文字色"
                value={
                  /^#[\da-f]{6}$/i.test(
                    editor.getAttributes("textStyle").color || "",
                  )
                    ? editor.getAttributes("textStyle").color
                    : "#263f3a"
                }
                onChange={(e) =>
                  editor.chain().focus().setColor(e.target.value).run()
                }
              />
            </label>
            {button(
              "ハイライト",
              <Highlighter size={16} />,
              () =>
                editor
                  .chain()
                  .focus()
                  .toggleHighlight({ color: "#fff0a8" })
                  .run(),
              editor.isActive("highlight"),
            )}
            <span className="toolbar-divider" />
            {button(
              "箇条書き",
              <List size={16} />,
              () => editor.chain().focus().toggleBulletList().run(),
              editor.isActive("bulletList"),
            )}
            {button(
              "番号付きリスト",
              <ListOrdered size={16} />,
              () => editor.chain().focus().toggleOrderedList().run(),
              editor.isActive("orderedList"),
            )}
            {button(
              "チェックリスト",
              <ListTodo size={16} />,
              () => editor.chain().focus().toggleTaskList().run(),
              editor.isActive("taskList"),
            )}
            {button(
              "引用",
              <Quote size={16} />,
              () => editor.chain().focus().toggleBlockquote().run(),
              editor.isActive("blockquote"),
            )}
            {button(
              "左揃え",
              <AlignLeft size={16} />,
              () => editor.chain().focus().setTextAlign("left").run(),
              editor.isActive({ textAlign: "left" }),
            )}
            {button(
              "中央揃え",
              <AlignCenter size={16} />,
              () => editor.chain().focus().setTextAlign("center").run(),
              editor.isActive({ textAlign: "center" }),
            )}
            {button(
              "右揃え",
              <AlignRight size={16} />,
              () => editor.chain().focus().setTextAlign("right").run(),
              editor.isActive({ textAlign: "right" }),
            )}
            {button(
              "リンク",
              <Link size={16} />,
              () => {
                setLinkUrl(editor.getAttributes("link").href || "");
                setLinkError("");
                setLinkEditor((v) => !v);
              },
              editor.isActive("link"),
            )}
            {button("表を挿入", <Table size={16} />, () =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run(),
            )}
            {button(
              "本文に画像を挿入",
              <ImagePlus size={16} />,
              props.chooseImage,
            )}
            {button(
              "本文にファイルを挿入",
              <Paperclip size={16} />,
              props.chooseFile,
            )}
            {button(
              "元に戻す",
              <Undo2 size={16} />,
              () => editor.chain().focus().undo().run(),
              false,
              !editor.can().undo(),
            )}
            {button(
              "やり直す",
              <Redo2 size={16} />,
              () => editor.chain().focus().redo().run(),
              false,
              !editor.can().redo(),
            )}
          </div>
        )}
        {linkEditor && (
          <form
            className="link-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const url = linkUrl.trim();
              if (!url)
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
              else if (safeLink(url))
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: url })
                  .run();
              else {
                setLinkError("https:// から始まるURLなどを入力してください。");
                return;
              }
              setLinkEditor(false);
            }}
          >
            <input
              autoFocus
              aria-label="リンク先URL"
              placeholder="https://"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <button type="submit">適用</button>
            <button type="button" onClick={() => setLinkEditor(false)}>
              閉じる
            </button>
            {linkError && <span role="alert">{linkError}</span>}
          </form>
        )}
        {editor.isActive("table") && !props.note.deleted && (
          <div className="table-tools" aria-label="表の操作">
            {[
              ["行を追加", () => editor.chain().focus().addRowAfter().run()],
              ["列を追加", () => editor.chain().focus().addColumnAfter().run()],
              ["行を削除", () => editor.chain().focus().deleteRow().run()],
              ["列を削除", () => editor.chain().focus().deleteColumn().run()],
              [
                "セルを結合／分割",
                () => editor.chain().focus().mergeOrSplit().run(),
              ],
              ["表を削除", () => editor.chain().focus().deleteTable().run()],
            ].map(([label, action]) => (
              <button
                type="button"
                key={String(label)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={action as () => void}
              >
                {String(label)}
              </button>
            ))}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </AssetContext.Provider>
  );
}

export function SourcePreview({ note, scope, remote, pending }: Assets) {
  const [open, setOpen] = useState(false),
    [html, setHtml] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open || !note.sourceHtml) return;
    let cancelled = false;
    const urls: string[] = [];
    setError("");
    setHtml("");
    (async () => {
      const doc = new DOMParser().parseFromString(
        DOMPurify.sanitize(note.sourceHtml!, {
          FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
          FORBID_ATTR: ["id"],
        }),
        "text/html",
      );
      for (const e of Array.from(doc.querySelectorAll<HTMLElement>("[style]")))
        e.setAttribute("style", safeStyle(e.getAttribute("style")));
      for (const e of Array.from(
        doc.querySelectorAll<HTMLElement>("[data-attachment-id]"),
      )) {
        const a = note.attachments.find((a) => a.id === e.dataset.attachmentId);
        if (!a || !a.type.startsWith("image/")) continue;
        const blob =
          pending.get(a.path) ||
          (await getBlob(scope, a.path)) ||
          (await remote?.blob(a.path));
        if (cancelled) return;
        if (blob) {
          const url = URL.createObjectURL(new Blob([blob], { type: a.type }));
          urls.push(url);
          e.setAttribute("src", url);
        }
      }
      if (!cancelled)
        setHtml(
          `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: https: http:; style-src 'unsafe-inline'"><meta name="referrer" content="no-referrer"><style>body{font-family:system-ui;overflow-wrap:anywhere;margin:16px;color:#263f3a}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${doc.body.innerHTML}</body></html>`,
        );
    })().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [open, note.id, note.sourceHtml, scope, remote]);
  if (!note.sourceHtml) return null;
  return (
    <details
      className="source-preview"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>取り込み時の表示</summary>
      <p>
        Evernoteから取り込んだ時点の内容です。上の本文の編集はここには反映されません。
      </p>
      {open &&
        (error ? (
          <p role="alert">{error}</p>
        ) : html ? (
          <iframe title="取り込み時の表示" sandbox="" srcDoc={html} />
        ) : (
          <p>読み込み中…</p>
        ))}
    </details>
  );
}
