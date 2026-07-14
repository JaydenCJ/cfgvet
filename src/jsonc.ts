/**
 * A small recursive-descent JSON parser with two properties the built-in
 * JSON.parse cannot offer:
 *
 *  1. Parse errors carry a 1-based line and column, so "settings.json is
 *     broken" becomes "unexpected `,` at line 12, column 3".
 *  2. Duplicate object keys are *reported* instead of silently collapsed —
 *     in agent config files the losing entry is a hook or MCP server that
 *     never runs, which is exactly the class of bug cfgvet exists to catch.
 *
 * JSONC mode additionally accepts line and block comments and trailing
 * commas, matching what VS Code applies to `.vscode/mcp.json`.
 */

export interface JsonIssue {
  /** "duplicate-key" for now; kept as a union for future lenient recoveries. */
  kind: "duplicate-key";
  key: string;
  line: number;
  column: number;
}

export interface JsonParseOk {
  ok: true;
  value: unknown;
  issues: JsonIssue[];
}

export interface JsonParseErr {
  ok: false;
  error: string;
  line: number;
  column: number;
}

export type JsonParseResult = JsonParseOk | JsonParseErr;

interface Cursor {
  text: string;
  pos: number;
  jsonc: boolean;
  issues: JsonIssue[];
}

class ParseError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(message);
  }
}

/** Translate an absolute offset into a 1-based line/column pair. */
export function lineColumn(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const bound = Math.min(pos, text.length);
  for (let i = 0; i < bound; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      last = i;
    }
  }
  return { line, column: bound - last };
}

/**
 * Parse `text` as JSON (`jsonc: true` additionally allows comments and
 * trailing commas). Never throws; the result is a tagged union.
 */
export function parseJson(text: string, options?: { jsonc?: boolean }): JsonParseResult {
  const c: Cursor = { text, pos: 0, jsonc: options?.jsonc === true, issues: [] };
  try {
    skipTrivia(c);
    if (c.pos >= c.text.length) throw new ParseError("file is empty", 0);
    const value = parseValue(c);
    skipTrivia(c);
    if (c.pos < c.text.length) {
      throw new ParseError(`unexpected \`${describeChar(c)}\` after the end of the document`, c.pos);
    }
    return { ok: true, value, issues: c.issues };
  } catch (e) {
    if (e instanceof ParseError) {
      const { line, column } = lineColumn(text, e.pos);
      return { ok: false, error: e.message, line, column };
    }
    throw e;
  }
}

function describeChar(c: Cursor): string {
  const ch = c.text[c.pos];
  if (ch === undefined) return "end of file";
  if (ch === "\n") return "\\n";
  if (ch === "\t") return "\\t";
  return ch;
}

function skipTrivia(c: Cursor): void {
  for (;;) {
    while (c.pos < c.text.length && " \t\r\n".includes(c.text[c.pos] as string)) c.pos++;
    if (!c.jsonc || c.text[c.pos] !== "/") return;
    const next = c.text[c.pos + 1];
    if (next === "/") {
      while (c.pos < c.text.length && c.text[c.pos] !== "\n") c.pos++;
    } else if (next === "*") {
      const start = c.pos;
      const end = c.text.indexOf("*/", c.pos + 2);
      if (end < 0) throw new ParseError("unterminated block comment", start);
      c.pos = end + 2;
    } else {
      return;
    }
  }
}

function parseValue(c: Cursor): unknown {
  const ch = c.text[c.pos];
  switch (ch) {
    case "{":
      return parseObject(c);
    case "[":
      return parseArray(c);
    case '"':
      return parseString(c);
    case "t":
      return parseKeyword(c, "true", true);
    case "f":
      return parseKeyword(c, "false", false);
    case "n":
      return parseKeyword(c, "null", null);
    case "'":
      throw new ParseError("strings must use double quotes, not single quotes", c.pos);
    default:
      if (ch !== undefined && (ch === "-" || (ch >= "0" && ch <= "9"))) return parseNumber(c);
      throw new ParseError(`unexpected \`${describeChar(c)}\``, c.pos);
  }
}

function parseKeyword(c: Cursor, word: string, value: unknown): unknown {
  if (c.text.startsWith(word, c.pos)) {
    c.pos += word.length;
    return value;
  }
  throw new ParseError(`unexpected \`${describeChar(c)}\``, c.pos);
}

/**
 * Assign without triggering setters: a config file containing a
 * "__proto__" key must become an ordinary property, not a prototype swap.
 */
function safeSet(out: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

function parseObject(c: Cursor): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  c.pos++; // consume {
  skipTrivia(c);
  if (c.text[c.pos] === "}") {
    c.pos++;
    return out;
  }
  for (;;) {
    skipTrivia(c);
    if (c.jsonc && c.text[c.pos] === "}") {
      // trailing comma before the closing brace
      c.pos++;
      return out;
    }
    if (c.text[c.pos] !== '"') {
      throw new ParseError(`expected a double-quoted property name, got \`${describeChar(c)}\``, c.pos);
    }
    const keyPos = c.pos;
    const key = parseString(c);
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      const { line, column } = lineColumn(c.text, keyPos);
      c.issues.push({ kind: "duplicate-key", key, line, column });
    }
    skipTrivia(c);
    if (c.text[c.pos] !== ":") {
      throw new ParseError(`expected \`:\` after property name "${key}", got \`${describeChar(c)}\``, c.pos);
    }
    c.pos++;
    skipTrivia(c);
    safeSet(out, key, parseValue(c));
    skipTrivia(c);
    const ch = c.text[c.pos];
    if (ch === ",") {
      c.pos++;
      continue;
    }
    if (ch === "}") {
      c.pos++;
      return out;
    }
    throw new ParseError(`expected \`,\` or \`}\` in object, got \`${describeChar(c)}\``, c.pos);
  }
}

function parseArray(c: Cursor): unknown[] {
  const out: unknown[] = [];
  c.pos++; // consume [
  skipTrivia(c);
  if (c.text[c.pos] === "]") {
    c.pos++;
    return out;
  }
  for (;;) {
    skipTrivia(c);
    if (c.jsonc && c.text[c.pos] === "]") {
      c.pos++;
      return out;
    }
    out.push(parseValue(c));
    skipTrivia(c);
    const ch = c.text[c.pos];
    if (ch === ",") {
      c.pos++;
      continue;
    }
    if (ch === "]") {
      c.pos++;
      return out;
    }
    throw new ParseError(`expected \`,\` or \`]\` in array, got \`${describeChar(c)}\``, c.pos);
  }
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function parseString(c: Cursor): string {
  const start = c.pos;
  c.pos++; // consume opening quote
  let out = "";
  for (;;) {
    const ch = c.text[c.pos];
    if (ch === undefined) throw new ParseError("unterminated string", start);
    if (ch === '"') {
      c.pos++;
      return out;
    }
    if (ch === "\n") throw new ParseError("unterminated string (newline inside string literal)", start);
    if (ch === "\\") {
      const esc = c.text[c.pos + 1];
      if (esc === undefined) throw new ParseError("unterminated string", start);
      if (esc === "u") {
        const hex = c.text.slice(c.pos + 2, c.pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new ParseError(`invalid \\u escape \`\\u${hex}\``, c.pos);
        }
        out += String.fromCharCode(parseInt(hex, 16));
        c.pos += 6;
        continue;
      }
      const mapped = ESCAPES[esc];
      if (mapped === undefined) throw new ParseError(`invalid escape \`\\${esc}\``, c.pos);
      out += mapped;
      c.pos += 2;
      continue;
    }
    out += ch;
    c.pos++;
  }
}

function parseNumber(c: Cursor): number {
  const start = c.pos;
  const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  re.lastIndex = c.pos;
  const m = re.exec(c.text);
  if (!m || m.index !== c.pos) throw new ParseError("malformed number", start);
  c.pos += m[0].length;
  return Number(m[0]);
}
