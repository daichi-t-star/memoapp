import { useId, useState } from "react";
import { Archive, ChevronRight, Folder } from "lucide-react";
import { folderGroups, type FolderItem } from "./folders";

export function FolderNavigation({
  folders,
  counts,
  scope,
  view,
  navigate,
}: {
  folders: string[];
  counts: ReadonlyMap<string, number>;
  scope: string;
  view: string;
  navigate: (view: string) => void;
}) {
  const storageKey = `memoapp_folder_groups:${scope}`;
  const id = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved)
        ? saved
        : {};
    } catch {
      return {};
    }
  });
  function toggle(name: string) {
    const next = { ...expanded, [name]: expanded[name] !== true };
    setExpanded(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The current session still supports opening and closing groups.
    }
  }
  function item(folder: FolderItem) {
    const selected = view === `folder:${folder.path}`;
    return (
      <button
        key={folder.path}
        title={folder.path}
        aria-label={`${folder.path} (${folder.count}件)`}
        aria-current={selected ? "page" : undefined}
        className={`nav-item ${selected ? "active" : ""}`}
        onClick={() => navigate(`folder:${folder.path}`)}
      >
        <Folder size={17} />
        <span>{folder.label}</span>
        <small>{folder.count}</small>
      </button>
    );
  }
  return folderGroups(folders, counts).map((group) => {
    if (!group.grouped) return item(group.items[0]);
    const open = expanded[group.name] === true;
    const containsSelection = group.items.some(
      (folder) => view === `folder:${folder.path}`,
    );
    const childrenId = `${id}-${encodeURIComponent(group.name)}`;
    return (
      <div
        key={group.name}
        className={`folder-group ${group.backup ? "backup-group" : ""}`}
      >
        <button
          className={`nav-item folder-group-toggle ${containsSelection && !open ? "contains-selection" : ""}`}
          aria-label={`${group.name}、${group.items.length}フォルダ、${group.count}件`}
          aria-expanded={open}
          aria-controls={childrenId}
          onClick={() => toggle(group.name)}
        >
          <ChevronRight
            size={14}
            className={open ? "group-chevron is-open" : "group-chevron"}
          />
          {group.backup ? <Archive size={17} /> : <Folder size={17} />}
          <span className="folder-group-label">
            <strong>{group.name}</strong>
            <span>
              {group.backup ? "バックアップ · " : ""}
              {group.items.length}フォルダ
            </span>
          </span>
          <small>{group.count}</small>
        </button>
        <div id={childrenId} className="folder-children" hidden={!open}>
          {open && group.items.map(item)}
        </div>
      </div>
    );
  });
}
