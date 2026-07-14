/**
 * Discovery: which harnesses are active in this project, and which
 * configuration artifacts each one contributes. Checks run only for
 * harnesses that are actually present (or explicitly requested), so a
 * pure-Cursor repo is never nagged about missing Claude files.
 */

import type { ConfigArtifact, Harness } from "./types.js";
import { Project } from "./project.js";

export interface Inventory {
  harnesses: Harness[];
  artifacts: ConfigArtifact[];
}

const md = (name: string) => name.endsWith(".md");
const mdc = (name: string) => name.endsWith(".mdc");

/** Enumerate the config artifacts of every harness present in `project`. */
export function discover(project: Project): Inventory {
  const artifacts: ConfigArtifact[] = [];
  const seen = new Set<Harness>();
  const add = (harness: Harness, file: string, kind: string): void => {
    artifacts.push({ harness, file, kind });
    seen.add(harness);
  };

  // --- Claude Code ---------------------------------------------------
  for (const f of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    if (project.isFile(f)) add("claude", f, "instructions");
  }
  for (const f of [".claude/settings.json", ".claude/settings.local.json"]) {
    if (project.isFile(f)) add("claude", f, "settings");
  }
  if (project.isFile(".mcp.json")) add("claude", ".mcp.json", "mcp");
  for (const f of project.filesUnder(".claude/hooks", () => true)) {
    add("claude", f, "hook script");
  }
  for (const f of project.filesUnder(".claude/commands", md)) {
    add("claude", f, "slash command");
  }
  for (const f of project.filesUnder(".claude/agents", md)) {
    add("claude", f, "agent");
  }
  for (const entry of project.listDir(".claude/skills")) {
    if (entry.dir) add("claude", `.claude/skills/${entry.name}`, "skill");
  }
  if (project.isDirectory(".claude") && !seen.has("claude")) {
    // A .claude directory with unrecognized content still marks the harness active.
    seen.add("claude");
  }

  // --- Cursor ---------------------------------------------------------
  if (project.isFile(".cursorrules")) add("cursor", ".cursorrules", "legacy rules");
  for (const f of project.filesUnder(".cursor/rules", mdc)) {
    add("cursor", f, "rule");
  }
  if (project.isFile(".cursor/mcp.json")) add("cursor", ".cursor/mcp.json", "mcp");
  if (project.isDirectory(".cursor") && !seen.has("cursor")) {
    seen.add("cursor");
  }

  // --- GitHub Copilot ---------------------------------------------------
  if (project.isFile(".github/copilot-instructions.md")) {
    add("copilot", ".github/copilot-instructions.md", "instructions");
  }
  for (const f of project.filesUnder(".github/instructions", (n) => n.endsWith(".instructions.md"))) {
    add("copilot", f, "scoped instructions");
  }
  if (project.isFile(".vscode/mcp.json")) add("copilot", ".vscode/mcp.json", "mcp");

  const harnesses: Harness[] = [];
  for (const h of ["claude", "cursor", "copilot"] as const) {
    if (seen.has(h)) harnesses.push(h);
  }
  return { harnesses, artifacts };
}
