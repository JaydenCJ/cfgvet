/**
 * A deliberately small YAML-subset parser for the frontmatter blocks used
 * by agent config files: `.cursor/rules/*.mdc`, `.claude/agents/*.md`,
 * `.claude/skills/<name>/SKILL.md` and `.github/instructions/*.instructions.md`.
 *
 * The subset covers what those files actually contain in the wild:
 * scalar values (plain, single- or double-quoted), booleans, numbers,
 * inline arrays (`[a, b]`) and block lists (`- item`). Anything deeper is
 * returned as an opaque string rather than mis-parsed — cfgvet's checks
 * only ever need flat keys.
 */

export type FrontmatterValue = string | number | boolean | string[];

export interface FrontmatterOk {
  ok: true;
  /** true when the file has no frontmatter block at all. */
  absent: boolean;
  data: Record<string, FrontmatterValue>;
  /** File content after the closing delimiter (the body). */
  body: string;
}

export interface FrontmatterErr {
  ok: false;
  error: string;
  line: number;
}

export type FrontmatterResult = FrontmatterOk | FrontmatterErr;

const DELIM = /^---\s*$/;

/**
 * Extract and parse the leading frontmatter of a markdown-ish document.
 * A document without a leading `---` is valid and reported as `absent`.
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !DELIM.test(lines[0] ?? "")) {
    return { ok: true, absent: true, data: {}, body: text };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIM.test(lines[i] ?? "")) {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return { ok: false, error: "frontmatter opened with `---` but never closed", line: 1 };
  }

  const data: Record<string, FrontmatterValue> = {};
  let pendingKey: string | null = null;
  let pendingList: string[] = [];

  const flushList = (): void => {
    // Only replace the key's empty scalar when list items actually followed;
    // a bare `key:` line stays the empty string.
    if (pendingKey !== null && pendingList.length > 0) {
      data[pendingKey] = pendingList;
    }
    pendingKey = null;
    pendingList = [];
  };

  for (let i = 1; i < close; i++) {
    const raw = lines[i] ?? "";
    const line = raw.replace(/\t/g, "  ");
    if (/^\s*(#.*)?$/.test(line)) continue; // blank or comment

    const listItem = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (listItem && pendingKey !== null) {
      pendingList.push(parseScalar(listItem[1] ?? "") as string);
      continue;
    }

    const kv = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(.*)$/.exec(line);
    if (!kv) {
      return { ok: false, error: `cannot parse frontmatter line \`${raw.trim()}\``, line: i + 1 };
    }
    flushList();
    const key = kv[1] ?? "";
    const rest = (kv[2] ?? "").trim();
    if (rest === "") {
      // Either an empty value or the start of a block list.
      pendingKey = key;
      data[key] = "";
      continue;
    }
    data[key] = parseValueText(rest);
    pendingKey = null;
  }
  flushList();

  return { ok: true, absent: false, data, body: lines.slice(close + 1).join("\n") };
}

function parseValueText(text: string): FrontmatterValue {
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return splitTopLevel(inner).map((part) => String(parseScalar(part.trim())));
  }
  return parseScalar(text);
}

/** Split on commas that are not inside quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of text) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}

function parseScalar(text: string): string | number | boolean {
  const t = text.trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}
