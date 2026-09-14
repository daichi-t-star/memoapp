export interface FolderItem {
  path: string;
  label: string;
  count: number;
}

export interface FolderGroup {
  name: string;
  backup: boolean;
  count: number;
  items: FolderItem[];
  grouped: boolean;
}

// Keep the saved paths intact; only the first separator creates a UI level.
export function folderGroups(
  folders: string[],
  counts: ReadonlyMap<string, number>,
): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  for (const path of new Set(folders)) {
    const separator = path.search(/[/／]/);
    const nested = separator > 0 && separator < path.length - 1;
    const name = nested ? path.slice(0, separator) : path;
    let group = groups.get(name);
    if (!group) {
      group = {
        name,
        backup: name.toLocaleLowerCase() === "evernote",
        count: 0,
        items: [],
        grouped: false,
      };
      groups.set(name, group);
    }
    const count = counts.get(path) || 0;
    group.grouped ||= nested;
    group.count += count;
    group.items.push({
      path,
      label: nested ? path.slice(separator + 1) : name,
      count,
    });
  }
  for (const group of groups.values()) {
    if (group.grouped) {
      for (const item of group.items) {
        if (item.path === group.name) item.label = "直下のメモ";
      }
    }
    group.items.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.backup) - Number(b.backup) || a.name.localeCompare(b.name, "ja"),
  );
}
