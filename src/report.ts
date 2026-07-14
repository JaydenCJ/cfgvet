/**
 * Renderers for scan results: the human-readable text report (findings
 * grouped by file, severity-first inside a file) and a stable JSON shape
 * for CI. Both are pure string builders — no I/O — so they are trivially
 * unit-testable and byte-deterministic.
 */

import type { Finding, ScanResult, Severity } from "./types.js";
import { summarize } from "./types.js";
import { VERSION } from "./version.js";

export type FailOn = Severity | "never";

const THRESHOLD: Record<Exclude<FailOn, "never">, number> = { error: 0, warning: 1, info: 2 };
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Should this finding list fail the run under the given gate? */
export function shouldFail(findings: readonly Finding[], failOn: FailOn): boolean {
  if (failOn === "never") return false;
  const limit = THRESHOLD[failOn];
  return findings.some((f) => RANK[f.severity] <= limit);
}

export interface RenderOptions {
  quiet?: boolean;
  failOn: FailOn;
}

/** "1 error", "2 errors" — count plus a correctly pluralized noun. */
function counted(n: number, noun: string, plural = noun + "s"): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

export function renderText(result: ScanResult, options: RenderOptions): string {
  const lines: string[] = [];
  const s = summarize(result.findings);
  lines.push(
    result.harnesses.length > 0
      ? `cfgvet: checking ${result.harnesses.join(", ")} (${counted(result.artifacts.length, "config file")})`
      : "cfgvet: nothing to check — no .claude, .cursor or Copilot configuration found here"
  );

  if (!options.quiet) {
    let currentFile: string | null = null;
    for (const f of result.findings) {
      if (f.file !== currentFile) {
        lines.push("");
        lines.push(f.file);
        currentFile = f.file;
      }
      const loc = f.where === "" ? "" : ` ${f.where}`;
      lines.push(`  ${f.severity} ${f.code}${loc}`);
      lines.push(`      ${f.message}`);
      lines.push(`      fix: ${f.fix}`);
    }
  }

  lines.push("");
  const verdict = shouldFail(result.findings, options.failOn) ? "FAIL" : "OK";
  lines.push(
    `cfgvet: ${verdict} — ${counted(s.errors, "error")}, ${counted(s.warnings, "warning")}, ${s.info} info (fail-on: ${options.failOn})`
  );
  return lines.join("\n") + "\n";
}

export function renderJson(result: ScanResult, options: RenderOptions): string {
  const s = summarize(result.findings);
  const payload = {
    cfgvet: VERSION,
    root: result.root,
    harnesses: result.harnesses,
    configFiles: result.artifacts.map((a) => ({ harness: a.harness, file: a.file, kind: a.kind })),
    findings: result.findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      harness: f.harness,
      file: f.file,
      where: f.where,
      message: f.message,
      fix: f.fix,
    })),
    summary: { errors: s.errors, warnings: s.warnings, info: s.info },
    failOn: options.failOn,
    ok: !shouldFail(result.findings, options.failOn),
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

/** The `cfgvet list` inventory view. */
export function renderList(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(
    `cfgvet: ${counted(result.artifacts.length, "config file")} across ${counted(result.harnesses.length, "harness", "harnesses")}`
  );
  for (const harness of result.harnesses) {
    lines.push("");
    lines.push(`${harness}:`);
    for (const a of result.artifacts.filter((x) => x.harness === harness)) {
      lines.push(`  ${a.file}  (${a.kind})`);
    }
  }
  if (result.harnesses.length === 0) {
    lines.push("");
    lines.push("no .claude, .cursor or Copilot configuration found here");
  }
  return lines.join("\n") + "\n";
}
