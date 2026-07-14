/**
 * A minimal glob matcher for the patterns that appear in agent config
 * files: Cursor rule `globs`, Copilot `applyTo` values and `.gitignore`
 * lines. Supports `**` (any number of path segments), `*` and `?` within
 * a segment, and single-level brace alternation `{a,b}`.
 *
 * Two conventions from those ecosystems are honored:
 *  - A pattern with no `/` matches the basename anywhere in the tree
 *    (`*.ts` gains an implicit leading `**` segment), which is how both Cursor and
 *    gitignore treat bare patterns.
 *  - A leading `/` anchors the pattern to the root.
 */

export interface CompiledGlob {
  source: string;
  regex: RegExp;
}

/** Compile one glob pattern. Returns null for an empty pattern. */
export function compileGlob(pattern: string): CompiledGlob | null {
  let p = pattern.trim();
  if (p === "") return null;
  if (p.startsWith("./")) p = p.slice(2);
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  if (!anchored && !p.includes("/")) p = "**/" + p;
  if (p.endsWith("/")) p += "**"; // directory pattern matches everything under it

  const segments = p.split("/");
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    if (seg === "**") {
      // `**/` matches zero or more whole segments.
      parts.push(i === segments.length - 1 ? ".*" : "(?:[^/]+/)*");
      continue;
    }
    parts.push(segmentToRegex(seg));
    if (i < segments.length - 1) parts.push("/");
  }
  try {
    return { source: pattern, regex: new RegExp("^" + parts.join("") + "$") };
  } catch {
    return null;
  }
}

function segmentToRegex(seg: string): string {
  let out = "";
  let i = 0;
  while (i < seg.length) {
    const ch = seg[i] as string;
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "{") {
      const close = seg.indexOf("}", i);
      if (close < 0) {
        out += "\\{";
      } else {
        const alts = seg
          .slice(i + 1, close)
          .split(",")
          .map((a) => a.split("").map(escapeChar).join(""));
        out += "(?:" + alts.join("|") + ")";
        i = close;
      }
    } else {
      out += escapeChar(ch);
    }
    i++;
  }
  return out;
}

function escapeChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
}

/** Does `pattern` match the relative posix path `file`? */
export function globMatches(pattern: string, file: string): boolean {
  const compiled = compileGlob(pattern);
  if (!compiled) return false;
  return compiled.regex.test(file);
}

/** Does `pattern` match at least one of `files`? */
export function globMatchesAny(pattern: string, files: readonly string[]): boolean {
  const compiled = compileGlob(pattern);
  if (!compiled) return false;
  for (const f of files) if (compiled.regex.test(f)) return true;
  return false;
}

/**
 * Split a Cursor-style `globs` value into individual patterns. Cursor
 * accepts both a YAML array and a bare comma-separated string; this
 * normalizes either shape.
 */
export function splitGlobList(value: string | readonly string[]): string[] {
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((s) => String(s).trim()).filter((s) => s !== "");
}
