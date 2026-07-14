/**
 * The scan engine: discover artifacts, run each active harness's checks,
 * then the cross-harness checks (MCP drift/parity, instructions parity),
 * and return one deterministically ordered ScanResult.
 */

import type { Finding, Harness, ScanResult } from "./types.js";
import { ALL_HARNESSES, compareFindings } from "./types.js";
import { Project } from "./project.js";
import { discover } from "./discover.js";
import { checkClaude } from "./checks/claude.js";
import { checkCursor } from "./checks/cursor.js";
import { checkCopilot } from "./checks/copilot.js";
import { checkMcp } from "./checks/mcp.js";
import { finding } from "./checks/context.js";

export interface ScanOptions {
  /**
   * Restrict checks to these harnesses. Defaults to every harness
   * detected in the project; harnesses not present are never checked.
   */
  harnesses?: readonly Harness[];
}

/** Scan a project root and return every finding. */
export function scan(root: string, options?: ScanOptions): ScanResult {
  const project = new Project(root);
  const inventory = discover(project);
  const wanted = options?.harnesses ?? ALL_HARNESSES;
  const active = inventory.harnesses.filter((h) => wanted.includes(h));

  const findings: Finding[] = [];
  if (active.includes("claude")) findings.push(...checkClaude(project));
  if (active.includes("cursor")) findings.push(...checkCursor(project));
  if (active.includes("copilot")) findings.push(...checkCopilot(project));
  findings.push(...checkMcp(project, active));
  findings.push(...checkInstructionsParity(project, active));

  findings.sort(compareFindings);
  return {
    root: project.root,
    harnesses: active,
    artifacts: inventory.artifacts.filter((a) => active.includes(a.harness)),
    findings,
  };
}

/**
 * I302: when two or more harnesses are active and one of them has project
 * instructions while another has none at all, point it out. Teams mixing
 * tools usually want at least a stub on every side.
 */
function checkInstructionsParity(project: Project, active: readonly Harness[]): Finding[] {
  if (active.length < 2) return [];

  const instructionsOf: Record<Harness, string | null> = {
    claude: firstExisting(project, ["CLAUDE.md", ".claude/CLAUDE.md"]),
    cursor:
      project.filesUnder(".cursor/rules", (n) => n.endsWith(".mdc"))[0] ??
      (project.isFile(".cursorrules") ? ".cursorrules" : null),
    copilot:
      firstExisting(project, [".github/copilot-instructions.md"]) ??
      project.filesUnder(".github/instructions", (n) => n.endsWith(".instructions.md"))[0] ??
      null,
  };

  const haves = active.filter((h) => instructionsOf[h] !== null);
  const havenots = active.filter((h) => instructionsOf[h] === null);
  if (haves.length === 0 || havenots.length === 0) return [];

  const source = haves[0] as Harness;
  return [
    finding(
      "I302",
      "cross",
      instructionsOf[source] as string,
      "",
      `${haves.join(" and ")} ${haves.length === 1 ? "has" : "have"} project instructions, but ${havenots.join(" and ")} ${havenots.length === 1 ? "has" : "have"} none`,
      `add a stub for ${havenots.join("/")} that points at ${instructionsOf[source]} so every tool follows the same rules`
    ),
  ];
}

function firstExisting(project: Project, candidates: readonly string[]): string | null {
  for (const c of candidates) if (project.isFile(c)) return c;
  return null;
}
