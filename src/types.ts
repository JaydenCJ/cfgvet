/**
 * Shared types for cfgvet: findings, severities, harness identifiers and
 * the scan result the CLI and the programmatic API both return.
 */

/** The three severities, in decreasing order of urgency. */
export type Severity = "error" | "warning" | "info";

/** The agent harnesses cfgvet knows how to read. */
export type Harness = "claude" | "cursor" | "copilot";

export const ALL_HARNESSES: readonly Harness[] = ["claude", "cursor", "copilot"];

/** One diagnostic produced by a check. */
export interface Finding {
  /** Stable rule code, e.g. "E102". Codes are never renumbered. */
  code: string;
  severity: Severity;
  /** Which harness's configuration produced the finding. */
  harness: Harness | "cross";
  /** Path of the offending file, relative to the scanned root (posix separators). */
  file: string;
  /**
   * Where inside the file the problem sits — a JSON-ish path such as
   * "hooks › PreToolUse › command", or "line 12" for text formats.
   * Empty when the finding is about the file as a whole.
   */
  where: string;
  /** One-sentence description of what is wrong. */
  message: string;
  /** Copy-pasteable (or at least concrete) remediation. */
  fix: string;
}

/** A configuration artifact cfgvet discovered and inspected. */
export interface ConfigArtifact {
  harness: Harness;
  /** Relative path (posix separators). */
  file: string;
  /** What kind of artifact this is, e.g. "settings", "hook script", "mcp". */
  kind: string;
}

/** The result of scanning one project root. */
export interface ScanResult {
  /** Absolute path that was scanned. */
  root: string;
  /** Harnesses detected as active in this project, in canonical order. */
  harnesses: Harness[];
  /** Every configuration artifact that was found and read. */
  artifacts: ConfigArtifact[];
  /** All findings, deterministically ordered (file, severity, code, where). */
  findings: Finding[];
}

/** Summary counts derived from a finding list. */
export interface Summary {
  errors: number;
  warnings: number;
  info: number;
}

export function summarize(findings: readonly Finding[]): Summary {
  const s: Summary = { errors: 0, warnings: 0, info: 0 };
  for (const f of findings) {
    if (f.severity === "error") s.errors += 1;
    else if (f.severity === "warning") s.warnings += 1;
    else s.info += 1;
  }
  return s;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Deterministic ordering: file path, then severity, then code, then location. */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const ra = SEVERITY_RANK[a.severity];
  const rb = SEVERITY_RANK[b.severity];
  if (ra !== rb) return ra - rb;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.where !== b.where) return a.where < b.where ? -1 : 1;
  return 0;
}
