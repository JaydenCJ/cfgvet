/**
 * Filesystem access for a scanned project: a bounded, deterministic walk
 * of the tree (for glob liveness checks) plus small helpers the checks
 * share. All paths handed to checks are root-relative with posix
 * separators, so findings look the same on every platform.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Directories that are never part of agent configuration. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".cache",
  "coverage",
  "vendor",
]);

const MAX_FILES = 50_000;
const MAX_DEPTH = 16;

export class Project {
  readonly root: string;
  /** Every regular file in the tree, relative posix paths, sorted. */
  readonly files: readonly string[];

  constructor(root: string) {
    this.root = path.resolve(root);
    const collected: string[] = [];
    walk(this.root, "", 0, collected);
    collected.sort();
    this.files = collected;
  }

  /** Absolute path for a root-relative posix path. */
  abs(rel: string): string {
    return path.join(this.root, ...rel.split("/"));
  }

  exists(rel: string): boolean {
    return fs.statSync(this.abs(rel), { throwIfNoEntry: false }) !== undefined;
  }

  isFile(rel: string): boolean {
    return fs.statSync(this.abs(rel), { throwIfNoEntry: false })?.isFile() === true;
  }

  isDirectory(rel: string): boolean {
    return fs.statSync(this.abs(rel), { throwIfNoEntry: false })?.isDirectory() === true;
  }

  isExecutable(rel: string): boolean {
    const st = fs.statSync(this.abs(rel), { throwIfNoEntry: false });
    return st !== undefined && st.isFile() && (st.mode & 0o111) !== 0;
  }

  /** Read a file as UTF-8; undefined when missing or unreadable. */
  readText(rel: string): string | undefined {
    try {
      return fs.readFileSync(this.abs(rel), "utf8");
    } catch {
      return undefined;
    }
  }

  /** Sorted names of entries directly under a directory (empty if absent). */
  listDir(rel: string): { name: string; dir: boolean }[] {
    try {
      const entries = fs.readdirSync(this.abs(rel), { withFileTypes: true });
      return entries
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return [];
    }
  }

  /** Files under `rel` (recursive) whose name matches `predicate`, sorted. */
  filesUnder(rel: string, predicate: (name: string) => boolean): string[] {
    const prefix = rel.endsWith("/") ? rel : rel + "/";
    return this.files.filter((f) => f.startsWith(prefix) && predicate(f.slice(f.lastIndexOf("/") + 1)));
  }
}

function walk(absRoot: string, rel: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rel === "" ? absRoot : path.join(absRoot, ...rel.split("/")), {
      withFileTypes: true,
    });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(absRoot, childRel, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(childRel);
    }
    // Symlinks are skipped: agent harnesses resolve them inconsistently
    // and following them can escape the scanned root.
  }
}
