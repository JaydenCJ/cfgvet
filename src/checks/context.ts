/**
 * Helpers shared by all check modules: a finding factory bound to the
 * rule catalog, JSON loading that reports E101/W212 uniformly, and the
 * command-string analyzer behind the exec-bit and dangling-reference
 * checks (E102/E103/W208/W209).
 */

import type { Finding, Harness, Severity } from "../types.js";
import { Project } from "../project.js";
import { parseJson, type JsonParseResult } from "../jsonc.js";
import { ruleByCode } from "../rules.js";

export function finding(
  code: string,
  harness: Harness | "cross",
  file: string,
  where: string,
  message: string,
  fix: string
): Finding {
  const rule = ruleByCode(code);
  if (!rule) throw new Error(`unknown rule code ${code}`);
  return { code, severity: rule.severity as Severity, harness, file, where, message, fix };
}

export interface LoadedJson {
  value: unknown;
  findings: Finding[];
}

/**
 * Read + parse a JSON config file. On a syntax error the returned value
 * is undefined and an E101 finding pinpoints line/column; duplicate keys
 * surface as W212 without blocking the rest of the checks.
 */
export function loadJsonFile(
  project: Project,
  harness: Harness,
  file: string,
  options?: { jsonc?: boolean }
): { value: unknown | undefined; findings: Finding[] } {
  const findings: Finding[] = [];
  const text = project.readText(file);
  if (text === undefined) return { value: undefined, findings };
  const result: JsonParseResult = parseJson(text, options);
  if (!result.ok) {
    findings.push(
      finding(
        "E101",
        harness,
        file,
        `line ${result.line}, column ${result.column}`,
        `not valid JSON: ${result.error}`,
        options?.jsonc
          ? "fix the syntax; this file allows comments and trailing commas, but the rest must be JSON"
          : "fix the syntax; this file must be plain JSON (no comments, no trailing commas)"
      )
    );
    return { value: undefined, findings };
  }
  for (const issue of result.issues) {
    findings.push(
      finding(
        "W212",
        harness,
        file,
        `line ${issue.line}, column ${issue.column}`,
        `duplicate key "${issue.key}" — the first occurrence is silently dropped`,
        `merge the two "${issue.key}" entries into one`
      )
    );
  }
  return { value: result.value, findings };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// ---------------------------------------------------------------------------
// Command-string analysis
// ---------------------------------------------------------------------------

/** Interpreters whose first non-flag argument is a script path. */
const INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "node", "python", "python3", "ruby", "perl", "deno", "bun"]);

const SCRIPT_EXT = /\.(sh|bash|zsh|js|mjs|cjs|ts|py|rb|pl)$/;

/** Prefixes that only exist on one person's machine. */
const MACHINE_PREFIX = /^(\/home\/|\/root\/|[A-Za-z]:[\\/](?:Users|home)[\\/]|~\/)/i;
const MACOS_USERS_PREFIX = /^\/(?:Users)\//;

export interface CommandAnalysis {
  findings: Finding[];
}

/** Split a shell command into words, honoring single and double quotes. */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (has) words.push(current);
      current = "";
      has = false;
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) words.push(current);
  return words;
}

/** Truncate a command list at the first shell control operator. */
function firstSegment(words: string[]): string[] {
  const stops = new Set(["&&", "||", "|", ";", ">", ">>", "<", "2>", "&"]);
  const out: string[] = [];
  for (const w of words) {
    if (stops.has(w)) break;
    out.push(w);
  }
  return out;
}

/**
 * Substitute $CLAUDE_PROJECT_DIR (both spellings) with the project root
 * marker. Returns null when the token still contains an unresolvable
 * substitution — those tokens are skipped, never guessed at.
 */
function resolveToken(token: string): string | null {
  let t = token.replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR/g, ".");
  if (/[$`]/.test(t)) return null;
  if (t.startsWith("./")) t = t.slice(2);
  return t;
}

export interface CommandCheckOptions {
  harness: Harness;
  file: string;
  where: string;
  /**
   * "shell" — a full shell command line (hooks, statusLine): the first
   * word is the program, interpreters get their script argument checked.
   * "argv0" — a bare program path (MCP `command`): no word splitting.
   */
  mode: "shell" | "argv0";
}

/**
 * Analyze a command reference for dangling paths (E102), missing exec
 * bits (E103), machine-specific prefixes (W208) and missing shebangs
 * (W209). Only paths that can be resolved inside the project are checked
 * for existence; bare program names are assumed to come from PATH.
 */
export function checkCommand(project: Project, command: string, opts: CommandCheckOptions): Finding[] {
  const findings: Finding[] = [];
  const words = opts.mode === "argv0" ? [command] : firstSegment(shellWords(command));
  const head = words[0];
  if (head === undefined || head === "") return findings;

  const machineSpecific = (token: string): boolean => {
    if (MACHINE_PREFIX.test(token) || MACOS_USERS_PREFIX.test(token)) {
      findings.push(
        finding(
          "W208",
          opts.harness,
          opts.file,
          opts.where,
          `"${token}" is a machine-specific absolute path — it will not exist on other machines`,
          "use $CLAUDE_PROJECT_DIR or a path relative to the repository root"
        )
      );
      return true;
    }
    return false;
  };

  const checkPath = (token: string, directExec: boolean): void => {
    if (machineSpecific(token)) return;
    const rel = resolveToken(token);
    if (rel === null) return; // unresolvable $VAR — don't guess
    if (rel.startsWith("/")) return; // other absolute paths: system binaries, out of scope
    if (!rel.includes("/") && !SCRIPT_EXT.test(rel)) return; // bare PATH lookup
    if (!project.isFile(rel)) {
      findings.push(
        finding(
          "E102",
          opts.harness,
          opts.file,
          opts.where,
          `references ${rel}, which does not exist`,
          `create ${rel} or remove this entry`
        )
      );
      return;
    }
    if (!directExec) return;
    if (!project.isExecutable(rel)) {
      findings.push(
        finding(
          "E103",
          opts.harness,
          opts.file,
          opts.where,
          `${rel} exists but is not executable`,
          `chmod +x ${rel}`
        )
      );
      return;
    }
    const text = project.readText(rel);
    if (text !== undefined && !text.startsWith("#!")) {
      findings.push(
        finding(
          "W209",
          opts.harness,
          opts.file,
          opts.where,
          `${rel} is executed directly but has no shebang line`,
          `add a first line like #!/usr/bin/env bash to ${rel}`
        )
      );
    }
  };

  if (opts.mode === "argv0") {
    checkPath(head, false);
    return findings;
  }

  const isInterpreter = INTERPRETERS.has(head.split("/").pop() ?? head);
  if (isInterpreter) {
    // The script is the first argument that is not a flag.
    for (const arg of words.slice(1)) {
      if (arg.startsWith("-")) continue;
      if (arg.includes("/") || SCRIPT_EXT.test(arg)) checkPath(arg, false);
      break;
    }
  } else {
    checkPath(head, true);
  }
  return findings;
}
