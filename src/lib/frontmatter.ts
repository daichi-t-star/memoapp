interface FrontmatterResult {
  data: Record<string, string | string[]>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    if (key === 'tags') {
      data.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else {
      data[key] = value;
    }
  }
  return { data, body: match[2] };
}

export function extractExcerpt(content: string, maxLen = 160): string {
  const { body } = parseFrontmatter(content);
  const lines = body.trim().split('\n');
  const contentLines = lines
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'))
    .map((l) => l.trim());
  const text = contentLines.join(' ');
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

export function stringifyFrontmatter(
  data: Record<string, string | string[]>,
  body: string,
): string {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return body;
  const lines = entries.map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`,
  );
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
