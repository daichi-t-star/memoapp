import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Copy,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  ImagePlus,
  LayoutGrid,
  List,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  Pin,
  Plus,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { NoteStore } from "./store";
import { isPending, scopeOf, type Connection, type StoredNote } from "./model";
import { Remote, synchronize } from "./remote";
import { AttachmentView } from "./AttachmentView";
import { Settings } from "./Settings";
import { download, exportBackup, importBackup } from "./backup";

const viewNames: Record<string, string> = {
  all: "すべてのメモ",
  pinned: "ピン留め",
  attachments: "添付ファイル",
  archive: "アーカイブ",
  trash: "ごみ箱",
};
const dateLabel = (value: string) =>
  Date.parse(value) === 0
    ? "以前のメモ"
    : new Date(value).toLocaleDateString("ja-JP", {
        month: "short",
        day: "numeric",
      });
const fullDate = (value: string) =>
  Date.parse(value) === 0
    ? "以前のバージョンから取り込み"
    : new Date(value).toLocaleString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

function Modal({
  children,
  close,
  label,
}: {
  children: ReactNode;
  close: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      "input,button,select,textarea,a[href]",
    );
    first?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key !== "Tab") return;
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
        ) || [],
      ).filter((e) => e.offsetParent !== null);
      const start = items[0],
        end = items[items.length - 1];
      if (e.shiftKey && document.activeElement === start) {
        e.preventDefault();
        end?.focus();
      }
      if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        start?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        {children}
      </div>
    </div>
  );
}

export function Workspace({
  connection,
  token,
  onConnect,
}: {
  connection: Connection | null;
  token: string;
  onConnect: (c: Connection | null, t: string) => void;
}) {
  const scope = scopeOf(connection);
  const store = useMemo(() => new NoteStore(scope), [scope]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const remote = useMemo(
    () => (connection && token ? new Remote(token, connection) : null),
    [connection, token],
  );
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem(`memoapp_last_note:${scope}`),
  );
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">(() =>
    localStorage.getItem("memoapp_layout") === "list" ? "list" : "grid",
  );
  const [sort, setSort] = useState("updated");
  const [settings, setSettings] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const m = matchMedia("(max-width: 700px)");
    const update = () => setMobile(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`memoapp_folders:${scope}`) || "[]",
      );
    } catch {
      return [];
    }
  });
  const [syncing, setSyncing] = useState(false);
  const [syncText, setSyncText] = useState("");
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
    null,
  );
  const syncLock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const pending = state.notes.filter(isPending).length;
  const note = state.notes.find((n) => n.id === selected);
  const links = [
    ...new Set(note?.text.match(/https?:\/\/[^\s<>"）)]+/g) || []),
  ];
  const active = state.notes.filter((n) => !n.deleted && !n.archived);
  const folders = [
    ...new Set([
      ...customFolders,
      ...state.notes.map((n) => n.folder).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, "ja"));
  const tags = [...new Set(active.flatMap((n) => n.tags))].sort();
  const title = view.startsWith("folder:")
    ? view.slice(7)
    : view.startsWith("tag:")
      ? view.slice(4)
      : viewNames[view];
  const visible = useMemo(() => {
    const words = query
      .toLocaleLowerCase()
      .normalize("NFKC")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return state.notes
      .filter((n) => {
        if (view === "trash" ? !n.deleted : n.deleted) return false;
        if (view === "archive" ? !n.archived : view !== "trash" && n.archived)
          return false;
        if (view === "pinned" && !n.pinned) return false;
        if (view === "attachments" && !n.attachments.length) return false;
        if (view.startsWith("folder:") && n.folder !== view.slice(7))
          return false;
        if (view.startsWith("tag:") && !n.tags.includes(view.slice(4)))
          return false;
        const haystack = [
          n.title,
          n.text,
          n.folder,
          ...n.tags,
          ...n.attachments.map((a) => a.name),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .normalize("NFKC");
        return words.every((word) => haystack.includes(word));
      })
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          (sort === "title"
            ? (a.title || "無題のメモ").localeCompare(
                b.title || "無題のメモ",
                "ja",
              )
            : b.updatedAt.localeCompare(a.updatedAt)),
      );
  }, [state.notes, query, view, sort]);
  useEffect(() => {
    store.refresh();
  }, [store]);
  useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(`memoapp:${scope}`);
    if (channel) channel.onmessage = () => store.refresh();
    let previousSaving = false;
    const stop = store.subscribe(() => {
      const saving = store.snapshot.saving;
      if (previousSaving && !saving) channel?.postMessage("changed");
      previousSaving = saving;
    });
    return () => {
      stop();
      channel?.close();
    };
  }, [store, scope]);
  const sync = useCallback(async () => {
    if (
      !remote ||
      syncLock.current ||
      !navigator.onLine ||
      store.snapshot.loading ||
      store.snapshot.error
    )
      return;
    syncLock.current = true;
    setSyncing(true);
    setSyncError("");
    try {
      await store.flush();
      const work = () =>
        synchronize(remote, scope, setSyncText, () => store.refresh());
      if (navigator.locks)
        await navigator.locks.request(`memoapp-sync:${scope}`, work);
      else await work();
      await store.refresh();
      setLastSync(
        new Date().toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      setSyncError(
        (e as Error).message ||
          "同期に失敗しました。編集内容は端末に保存されています。",
      );
    } finally {
      syncLock.current = false;
      setSyncing(false);
      setSyncText("");
    }
  }, [remote, scope, store]);
  useEffect(() => {
    if (state.loading) return;
    void sync();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 60000);
    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [sync, state.loading]);
  const signature = state.notes.map((n) => n.revision).join("|");
  useEffect(() => {
    if (
      !pending ||
      !remote ||
      syncing ||
      syncError ||
      state.error ||
      state.saving
    )
      return;
    const timer = setTimeout(() => {
      if (!composing.current) void sync();
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    signature,
    pending,
    remote,
    sync,
    syncing,
    syncError,
    state.error,
    state.saving,
  ]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (store.snapshot.saving || store.snapshot.error) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [store]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setMenu(false);
    setTagInput("");
    if (selected) localStorage.setItem(`memoapp_last_note:${scope}`, selected);
    else localStorage.removeItem(`memoapp_last_note:${scope}`);
  }, [selected, scope]);
  async function create() {
    try {
      const id = await store.create(
        view.startsWith("folder:") ? view.slice(7) : "",
      );
      setSelected(id);
      setQuery("");
      if (!view.startsWith("folder:")) setView("all");
      setSidebar(false);
      requestAnimationFrame(() => titleRef.current?.focus());
    } catch {
      /* store exposes durable-save error */
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void sync();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sync]);
  const update = (patch: Partial<StoredNote>) => {
    if (note) void store.update(note.id, patch).catch(() => {});
  };
  function navigate(next: string) {
    setView(next);
    setSelected(null);
    setSidebar(false);
    setMenu(false);
  }
  async function attach(files: FileList | File[] | null) {
    if (!note || !files?.length) return;
    const id = note.id;
    setAttaching(true);
    try {
      await store.attach(id, Array.from(files));
      setToast(`${files.length}個のファイルを添付しました`);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setAttaching(false);
    }
  }
  async function backup() {
    setToast("バックアップを準備しています…");
    try {
      await store.flush();
      const missing = await exportBackup(
        scope,
        store.snapshot.notes,
        (path) => store.pendingFiles.get(path),
        remote && online ? (path) => remote.blob(path) : undefined,
      );
      setToast(
        missing
          ? `メモを書き出しました。未取得の添付が${missing}件あります。各添付を開いて取得後、再書き出ししてください。`
          : "メモと添付ファイルのバックアップを書き出しました",
      );
    } catch (e) {
      setToast(`書き出せませんでした：${(e as Error).message}`);
    }
  }
  const status = !online
    ? "オフライン・端末に保存"
    : syncing
      ? syncText || "同期しています…"
      : syncError
        ? "同期を再試行してください"
        : remote
          ? pending
            ? `${pending}件の変更が同期待ち`
            : "すべて同期済み"
          : "この端末に保存";
  const navButton = (key: string, icon: ReactNode, count?: number) => (
    <button
      className={`nav-item ${view === key ? "active" : ""}`}
      onClick={() => navigate(key)}
      key={key}
    >
      {icon}
      <span>{viewNames[key] || key.slice(key.indexOf(":") + 1)}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
  return (
    <div className={`app-shell ${note ? "has-editor" : ""}`}>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="メニューを閉じる"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        inert={
          Boolean(settings || folderDialog || preview) || (mobile && !sidebar)
        }
        className={`sidebar ${sidebar ? "is-open" : ""}`}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("all");
          }}
        >
          <span className="brand-icon">
            <NotebookPen size={23} />
          </span>
          <span>
            memo<span className="brand-dot">.</span>
          </span>
          <span className="version">2.0</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => setSettings(true)}
          disabled={syncing}
        >
          <span className="workspace-avatar">
            {connection ? connection.owner.slice(0, 1).toUpperCase() : "M"}
          </span>
          <span>
            <strong>マイワークスペース</strong>
            <small>{connection?.repo || "この端末のメモ"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button
          className="new-note button primary"
          onClick={create}
          disabled={state.loading}
        >
          <Plus size={18} />
          新しいメモ
        </button>
        <span className="nav-heading">ライブラリ</span>
        <nav aria-label="メモの分類">
          {navButton("all", <NotebookPen size={18} />, active.length)}
          {navButton(
            "pinned",
            <Pin size={17} />,
            active.filter((n) => n.pinned).length,
          )}
          {navButton(
            "attachments",
            <Paperclip size={17} />,
            active.filter((n) => n.attachments.length).length,
          )}
        </nav>
        <div className="nav-heading heading-with-action">
          フォルダ
          <button
            className="icon-button"
            aria-label="フォルダを追加"
            onClick={() => {
              setFolderInput("");
              setFolderDialog(true);
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="folder-nav" aria-label="フォルダ">
          {folders.map((folder, i) => (
            <button
              key={folder}
              className={`nav-item ${view === `folder:${folder}` ? "active" : ""}`}
              onClick={() => navigate(`folder:${folder}`)}
            >
              <Folder size={17} className={`folder-color-${i % 4}`} />
              <span>{folder}</span>
              <small>{active.filter((n) => n.folder === folder).length}</small>
            </button>
          ))}
          {!folders.length && (
            <button
              className="add-folder"
              onClick={() => setFolderDialog(true)}
            >
              <FolderPlus size={15} />
              フォルダを作成
            </button>
          )}
        </nav>
        {tags.length > 0 && (
          <>
            <span className="nav-heading">タグ</span>
            <div className="sidebar-tags">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className={view === `tag:${tag}` ? "selected" : ""}
                  onClick={() => navigate(`tag:${tag}`)}
                >
                  <span>#</span>
                  {tag}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <nav>
            {navButton("archive", <Archive size={17} />)}
            {navButton("trash", <Trash2 size={17} />)}
          </nav>
          <div className="sync-summary">
            <span className={`sync-dot ${syncError ? "error" : ""}`} />
            <div>
              <strong>{remote ? "GitHubと同期" : "端末に自動保存"}</strong>
              <small>
                {remote
                  ? lastSync
                    ? `最終同期 ${lastSync}`
                    : "メモと添付をまとめて保存"
                  : "接続なしでも、思いついたときに。"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="保存先と同期の設定"
              onClick={() => setSettings(true)}
              disabled={syncing}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div
        className="app-main"
        inert={
          Boolean(settings || folderDialog || preview) || (mobile && sidebar)
        }
      >
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="メニューを開く"
            onClick={() => setSidebar(true)}
          >
            <Menu size={20} />
          </button>
          <span className="breadcrumb">
            ワークスペース
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </span>
          <div className="topbar-right">
            <span
              className={`connection-status ${syncError ? "has-error" : ""}`}
              title={status}
            >
              {!online ? (
                <CloudOff size={15} />
              ) : syncing ? (
                <LoaderCircle size={15} className="spin" />
              ) : remote ? (
                <Cloud size={15} />
              ) : (
                <HardDrive size={15} />
              )}
              <span>{status}</span>
            </span>
            <button
              className="icon-button"
              aria-label="設定"
              onClick={() => setSettings(true)}
              disabled={syncing}
            >
              <Settings2 size={18} />
            </button>
            <span className="user-avatar">
              {connection ? connection.owner.slice(0, 1).toUpperCase() : "M"}
            </span>
          </div>
        </header>
        {(state.error || syncError) && (
          <div className="error-banner" role="alert">
            <span>{state.error || syncError}</span>
            <button
              onClick={() =>
                state.error ? store.retry().catch(() => {}) : sync()
              }
            >
              {state.error ? "再保存" : "今すぐ同期"}
            </button>
            {state.error && <button onClick={backup}>バックアップ</button>}
          </div>
        )}
        <section className={`workspace-content ${note ? "split-view" : ""}`}>
          <div className="library">
            <div className="library-heading">
              <div>
                <span className="eyebrow">YOUR IDEAS, WITHIN REACH</span>
                <h1>
                  {query ? "検索結果" : title}
                  <span>{visible.length}</span>
                </h1>
                <p>
                  {view === "trash"
                    ? "削除したメモは、ここからいつでも元に戻せます。"
                    : view === "archive"
                      ? "ひと区切りついたメモを、いつでも読み返せる場所に。"
                      : "思いつきを残して、必要なときに、すぐ手元に。"}
                </p>
              </div>
              <button
                className="button secondary heading-create"
                onClick={create}
              >
                <Plus size={17} />
                メモを作成
              </button>
            </div>
            <div className="library-controls">
              <div className="search-field">
                <Search size={17} />
                <input
                  ref={searchRef}
                  aria-label="メモを検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="タイトル、本文、添付を検索"
                />
                {query ? (
                  <button
                    className="icon-button"
                    onClick={() => setQuery("")}
                    aria-label="検索をクリア"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd>⌘ K</kbd>
                )}
              </div>
              <div className="view-toggle" aria-label="表示形式">
                <button
                  aria-label="カード表示"
                  aria-pressed={layout === "grid"}
                  className={layout === "grid" ? "selected" : ""}
                  onClick={() => {
                    setLayout("grid");
                    localStorage.setItem("memoapp_layout", "grid");
                  }}
                >
                  <LayoutGrid size={17} />
                </button>
                <button
                  aria-label="リスト表示"
                  aria-pressed={layout === "list"}
                  className={layout === "list" ? "selected" : ""}
                  onClick={() => {
                    setLayout("list");
                    localStorage.setItem("memoapp_layout", "list");
                  }}
                >
                  <List size={19} />
                </button>
              </div>
            </div>
            <div className="list-meta">
              <span>
                {query
                  ? `「${query}」を含むメモ`
                  : view === "pinned"
                    ? "大切なメモを、すぐそばに"
                    : "あなたのメモ"}
              </span>
              <select
                aria-label="メモの並び順"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="updated">更新日が新しい順</option>
                <option value="title">タイトル順</option>
              </select>
            </div>
            {state.loading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" />
                <h2>メモを開いています</h2>
              </div>
            ) : visible.length ? (
              <div className={`note-collection ${layout}`}>
                {visible.map((n) => (
                  <button
                    key={n.id}
                    className={`note-card ${n.id === selected ? "selected" : ""} ${n.pinned ? "is-pinned" : ""}`}
                    onClick={() => setSelected(n.id)}
                  >
                    <div className="note-card-top">
                      <span className="note-category">
                        <Folder size={13} />
                        {n.folder || "メモ"}
                      </span>
                      {n.pinned && <Pin size={14} className="pin-marker" />}
                    </div>
                    <h2>{n.title || "無題のメモ"}</h2>
                    <p className="note-excerpt">
                      {n.text ||
                        (n.attachments.length
                          ? "添付ファイルを保存したメモ"
                          : "ここから、思いつきを書きとめよう。")}
                    </p>
                    {n.tags.length > 0 && (
                      <div className="card-tags">
                        {n.tags.slice(0, 3).map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                      </div>
                    )}
                    <div className="note-card-footer">
                      <time>{dateLabel(n.updatedAt)}</time>
                      <span>
                        {n.attachments.length > 0 && (
                          <>
                            <Paperclip size={13} />
                            {n.attachments.length}
                          </>
                        )}
                        {remote && isPending(n) && (
                          <span className="pending-dot" title="同期待ち" />
                        )}
                        <ArrowUpRight size={15} className="card-arrow" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-art">
                  <div className="paper-sheet">
                    <span />
                    <span />
                    <span />
                    <NotebookPen size={31} />
                  </div>
                  <i className="art-dot" />
                </div>
                <span className="eyebrow">A LITTLE SPACE FOR YOUR MIND</span>
                <h2>
                  {query
                    ? "メモが見つかりませんでした"
                    : view === "all"
                      ? "小さな思いつきから、はじめよう。"
                      : "ここにはまだメモがありません"}
                </h2>
                <p>
                  {query ? (
                    "別のキーワードで検索してみてください。"
                  ) : view === "all" ? (
                    <>
                      アイデアも、写真も、大切な資料も。
                      <br />
                      あなたの毎日を、ひとつの場所に。
                    </>
                  ) : (
                    "必要なメモだけを、すっきりと整理できます。"
                  )}
                </p>
                {query ? (
                  <button
                    className="button secondary"
                    onClick={() => setQuery("")}
                  >
                    検索をクリア
                  </button>
                ) : (
                  <button className="button primary" onClick={create}>
                    <Plus size={17} />
                    最初のメモを書く
                  </button>
                )}
                {!connection && !query && view === "all" && (
                  <button
                    className="text-button"
                    onClick={() => setSettings(true)}
                  >
                    以前のメモをGitHubから取り込む
                    <ArrowUpRight size={14} />
                  </button>
                )}
                <div className="empty-features">
                  <span>
                    <CheckCheck size={15} />
                    自動保存
                  </span>
                  <span>
                    <Paperclip size={15} />
                    画像・ファイル添付
                  </span>
                  <span>
                    <Search size={15} />
                    すばやく検索
                  </span>
                </div>
              </div>
            )}
            <footer className="library-footer">
              <span>ひらめきを、取りこぼさない。</span>
              <div>
                <button onClick={backup} title="メモと取得済み添付を書き出す">
                  <ArrowDownToLine size={14} />
                  バックアップ
                </button>
                <button onClick={() => backupInput.current?.click()}>
                  <Upload size={14} />
                  復元
                </button>
              </div>
            </footer>
          </div>
          {note && (
            <article
              className={`note-editor ${dragging ? "is-dragging" : ""}`}
              onDragOver={(e) => {
                if (!note.deleted) {
                  e.preventDefault();
                  setDragging(true);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!note.deleted) void attach(e.dataTransfer.files);
              }}
            >
              <div className="editor-toolbar">
                <button
                  className="icon-button"
                  onClick={() => setSelected(null)}
                  aria-label="メモ一覧に戻る"
                >
                  <ArrowLeft size={19} />
                </button>
                <span
                  className={`save-status ${state.error ? "has-error" : ""}`}
                >
                  {state.saving ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : state.error ? (
                    <CloudOff size={14} />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>
                    {state.saving
                      ? "保存中…"
                      : state.error
                        ? "保存できませんでした"
                        : "端末に保存済み"}
                  </span>
                </span>
                <div className="editor-actions">
                  {!note.deleted && (
                    <button
                      className={`icon-button ${note.pinned ? "active" : ""}`}
                      onClick={() => update({ pinned: !note.pinned })}
                      aria-label={
                        note.pinned ? "ピン留めを解除" : "ピン留めする"
                      }
                      aria-pressed={note.pinned}
                    >
                      <Pin size={17} />
                    </button>
                  )}
                  <div className="menu-wrap">
                    <button
                      className="icon-button"
                      aria-label="メモの操作"
                      aria-expanded={menu}
                      onClick={() => setMenu(!menu)}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    {menu && (
                      <>
                        <button
                          className="menu-dismiss"
                          aria-label="操作メニューを閉じる"
                          onClick={() => setMenu(false)}
                        />
                        <div className="action-menu">
                          <button
                            onClick={async () => {
                              const id = await store
                                .duplicate(note.id)
                                .catch(() => undefined);
                              if (id) setSelected(id);
                              setMenu(false);
                            }}
                          >
                            <Copy size={15} />
                            複製する
                          </button>
                          <button
                            onClick={() => {
                              download(
                                new Blob([`${note.title}\n\n${note.text}`], {
                                  type: "text/plain;charset=utf-8",
                                }),
                                `${note.title.replace(/[\\/:*?"<>|]/g, "_") || "メモ"}.txt`,
                              );
                              setMenu(false);
                            }}
                          >
                            <ArrowDownToLine size={15} />
                            テキストを書き出す
                          </button>
                          {!note.deleted && (
                            <button
                              onClick={() => {
                                update({ archived: !note.archived });
                                setMenu(false);
                                setSelected(null);
                              }}
                            >
                              <Archive size={15} />
                              {note.archived
                                ? "アーカイブから戻す"
                                : "アーカイブする"}
                            </button>
                          )}
                          <button
                            className={note.deleted ? "" : "danger-text"}
                            onClick={() => {
                              update({ deleted: !note.deleted });
                              setSelected(null);
                              setMenu(false);
                              setToast(
                                note.deleted
                                  ? "メモを元に戻しました"
                                  : "ごみ箱に移動しました。ごみ箱から復元できます。",
                              );
                            }}
                          >
                            {note.deleted ? (
                              <Undo2 size={15} />
                            ) : (
                              <Trash2 size={15} />
                            )}{" "}
                            {note.deleted ? "元に戻す" : "ごみ箱に移動"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {note.deleted && (
                <div className="trash-notice">
                  <Trash2 size={16} />
                  このメモはごみ箱にあります
                  <button
                    onClick={() => {
                      update({ deleted: false });
                      navigate("all");
                    }}
                  >
                    元に戻す
                  </button>
                </div>
              )}
              <div className="editor-scroll">
                <div className="editor-document">
                  <div className="editor-folder">
                    <Folder size={14} />
                    <select
                      aria-label="メモのフォルダ"
                      value={note.folder}
                      disabled={note.deleted}
                      onChange={(e) => update({ folder: e.target.value })}
                    >
                      <option value="">フォルダなし</option>
                      {folders.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                    <span className="document-kind">MEMO</span>
                  </div>
                  <input
                    ref={titleRef}
                    className="title-input"
                    aria-label="メモのタイトル"
                    placeholder="無題のメモ"
                    value={note.title}
                    disabled={note.deleted}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                  <div className="note-date">
                    <span>更新 {fullDate(note.updatedAt)}</span>
                    {note.archived && <span>アーカイブ済み</span>}
                  </div>
                  <div className="editor-tags">
                    {note.tags.map((t) => (
                      <button
                        key={t}
                        disabled={note.deleted}
                        onClick={() =>
                          update({ tags: note.tags.filter((tag) => tag !== t) })
                        }
                        title="タグを外す"
                      >
                        #{t}
                        <X size={11} />
                      </button>
                    ))}
                    {!note.deleted && (
                      <input
                        aria-label="タグを追加"
                        placeholder="＋ タグを追加"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            const t = tagInput.trim().replace(/^#/, "");
                            if (t && !note.tags.includes(t))
                              update({ tags: [...note.tags, t] });
                            setTagInput("");
                          }
                        }}
                      />
                    )}
                  </div>
                  <textarea
                    className="body-input"
                    aria-label="メモ本文"
                    value={note.text}
                    disabled={note.deleted}
                    placeholder={
                      "ここに、自由に書いてみましょう。\n\n書式のルールはありません。\n写真やファイルは、ここにドロップして添付できます。"
                    }
                    onChange={(e) => update({ text: e.target.value })}
                    onCompositionStart={() => {
                      composing.current = true;
                    }}
                    onCompositionEnd={() => {
                      composing.current = false;
                    }}
                    onPaste={(e) => {
                      if (e.clipboardData.files.length) {
                        e.preventDefault();
                        void attach(e.clipboardData.files);
                      }
                    }}
                  />
                  {links.length > 0 && (
                    <div className="note-links" aria-label="メモ内のリンク">
                      {links.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ArrowUpRight size={14} />
                          <span>{url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <section className="attachments-section">
                    <div className="attachments-heading">
                      <h3>
                        <Paperclip size={16} />
                        添付ファイル<span>{note.attachments.length}</span>
                      </h3>
                      {!note.deleted && (
                        <button
                          className="text-button"
                          onClick={() => fileInput.current?.click()}
                          disabled={attaching}
                        >
                          <Plus size={15} />
                          追加
                        </button>
                      )}
                    </div>
                    {note.attachments.length > 0 && (
                      <div className="attachments-grid">
                        {note.attachments.map((a) => (
                          <AttachmentView
                            key={a.id}
                            attachment={a}
                            ready={!store.pendingFiles.has(a.path)}
                            scope={scope}
                            remote={remote}
                            preview={(url, name) => setPreview({ url, name })}
                            remove={
                              note.deleted
                                ? undefined
                                : () =>
                                    update({
                                      attachments: note.attachments.filter(
                                        (item) => item.id !== a.id,
                                      ),
                                    })
                            }
                          />
                        ))}
                      </div>
                    )}
                    {!note.deleted && (
                      <button
                        className="attachment-dropzone"
                        onClick={() => fileInput.current?.click()}
                        disabled={attaching}
                      >
                        {attaching ? (
                          <LoaderCircle size={23} className="spin" />
                        ) : (
                          <Upload size={23} />
                        )}
                        <span>
                          <strong>
                            {attaching
                              ? "添付を保存しています…"
                              : "ファイルをドロップ、または選択"}
                          </strong>
                          <small>
                            画像、PDF、Word、Excelなど · 1ファイル20 MBまで
                          </small>
                        </span>
                        <Plus size={18} />
                      </button>
                    )}
                  </section>
                </div>
              </div>
              <footer className="editor-footer">
                <div>
                  {!note.deleted && (
                    <>
                      <button
                        onClick={() => imageInput.current?.click()}
                        disabled={attaching}
                      >
                        <ImagePlus size={17} />
                        画像
                      </button>
                      <button
                        onClick={() => fileInput.current?.click()}
                        disabled={attaching}
                      >
                        <Paperclip size={17} />
                        ファイル
                      </button>
                    </>
                  )}
                </div>
                <span>
                  {note.text.length.toLocaleString()}文字
                  <span className="footer-divider" />
                  自動保存
                </span>
              </footer>
              {dragging && (
                <div className="drop-overlay">
                  <Upload size={38} />
                  <strong>ここにドロップして添付</strong>
                </div>
              )}
            </article>
          )}
        </section>
      </div>
      <input
        type="file"
        multiple
        hidden
        ref={fileInput}
        onChange={(e) => {
          void attach(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        multiple
        accept="image/*"
        hidden
        ref={imageInput}
        onChange={(e) => {
          void attach(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        hidden
        accept="application/json,.json"
        ref={backupInput}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const count = await importBackup(f, scope);
            await store.refresh();
            setToast(`${count}件をコピーとして復元しました`);
          } catch (error) {
            setToast((error as Error).message);
          }
        }}
      />
      {settings && (
        <Modal label="保存先と同期" close={() => setSettings(false)}>
          <Settings
            connection={connection}
            token={token}
            close={() => setSettings(false)}
            connect={(c, t) => {
              setSettings(false);
              onConnect(c, t);
            }}
          />
        </Modal>
      )}
      {folderDialog && (
        <Modal label="フォルダを作成" close={() => setFolderDialog(false)}>
          <form
            className="modal-card"
            onSubmit={(e) => {
              e.preventDefault();
              const value = folderInput.trim();
              if (!value) return;
              const next = [...new Set([...customFolders, value])];
              setCustomFolders(next);
              localStorage.setItem(
                `memoapp_folders:${scope}`,
                JSON.stringify(next),
              );
              setFolderDialog(false);
              navigate(`folder:${value}`);
            }}
          >
            <div className="modal-header">
              <h2>フォルダを作成</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="閉じる"
                onClick={() => setFolderDialog(false)}
              >
                <X size={19} />
              </button>
            </div>
            <label htmlFor="folder-name">フォルダ名</label>
            <input
              id="folder-name"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="例：仕事、アイデア、暮らし"
              maxLength={80}
            />
            <button
              className="button primary full"
              disabled={!folderInput.trim()}
            >
              <FolderPlus size={16} />
              作成する
            </button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal label={preview.name} close={() => setPreview(null)}>
          <div className="lightbox">
            <button
              className="icon-button"
              onClick={() => setPreview(null)}
              aria-label="画像を閉じる"
            >
              <X size={24} />
            </button>
            <img src={preview.url} alt={preview.name} />
            <p>{preview.name}</p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="通知を閉じる"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
