// Shared test helpers: build a throwaway project tree from a plain object
// (path -> content, or path -> { content, mode }) inside a fresh temp
// directory, and clean it up afterwards. Every test is hermetic: no
// network, no shared state, no reliance on the repo's own tree.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfgvet-test-"));
  for (const [rel, spec] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (typeof spec === "string") {
      fs.writeFileSync(abs, spec);
    } else {
      fs.writeFileSync(abs, spec.content ?? "");
      if (spec.mode !== undefined) fs.chmodSync(abs, spec.mode);
    }
  }
  return dir;
}

export function rmProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Run `fn(dir)` against a temp project and always clean up. */
export function withProject(files, fn) {
  const dir = makeProject(files);
  try {
    return fn(dir);
  } finally {
    rmProject(dir);
  }
}

/** Sorted rule codes of a finding list — the usual assertion target. */
export function codes(findings) {
  return findings.map((f) => f.code).sort();
}

/** Findings with a given code. */
export function ofCode(findings, code) {
  return findings.filter((f) => f.code === code);
}
