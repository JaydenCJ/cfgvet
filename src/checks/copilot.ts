/**
 * Checks for the GitHub Copilot surface: `.github/copilot-instructions.md`
 * and the scoped `.github/instructions/*.instructions.md` files with
 * their `applyTo` globs. `.vscode/mcp.json` is handled by the shared MCP
 * module (in JSONC mode, since VS Code owns that file).
 */

import type { Finding } from "../types.js";
import { Project } from "../project.js";
import { parseFrontmatter } from "../frontmatter.js";
import { globMatchesAny, splitGlobList } from "../glob.js";
import { finding } from "./context.js";

export function checkCopilot(project: Project): Finding[] {
  const findings: Finding[] = [];

  const main = ".github/copilot-instructions.md";
  if (project.isFile(main)) {
    const text = project.readText(main);
    if (text !== undefined && text.trim() === "") {
      findings.push(
        finding("W206", "copilot", main, "", "instructions file is empty — Copilot loads it and learns nothing", "write the project conventions, or delete the file")
      );
    }
  }

  for (const file of project.filesUnder(".github/instructions", (n) => n.endsWith(".instructions.md"))) {
    checkScopedInstructions(project, file, findings);
  }

  return findings;
}

function checkScopedInstructions(project: Project, file: string, findings: Finding[]): void {
  const text = project.readText(file);
  if (text === undefined) return;
  const fm = parseFrontmatter(text);
  if (!fm.ok) {
    findings.push(finding("E108", "copilot", file, `line ${fm.line}`, fm.error, "close the frontmatter block with a second --- line"));
    return;
  }

  if (fm.body.trim() === "") {
    findings.push(finding("W206", "copilot", file, "", "instructions body is empty", "write the instructions below the frontmatter"));
  }

  const applyToRaw = fm.data["applyTo"];
  const patterns =
    typeof applyToRaw === "string" || Array.isArray(applyToRaw)
      ? splitGlobList(applyToRaw as string | string[])
      : [];

  if (fm.absent || patterns.length === 0) {
    findings.push(
      finding(
        "W205",
        "copilot",
        file,
        "",
        fm.absent
          ? "file has no frontmatter — without an applyTo glob it never attaches to a request"
          : "frontmatter has no applyTo glob — the instructions never attach to a request",
        'add frontmatter with `applyTo: "**/*.ts"` (or the scope you want; `"**"` for everything)'
      )
    );
    return;
  }

  for (const pattern of patterns) {
    if (pattern === "**") continue; // matches by definition
    if (!globMatchesAny(pattern, project.files)) {
      findings.push(
        finding(
          "W204",
          "copilot",
          file,
          `applyTo › ${pattern}`,
          `applyTo glob "${pattern}" matches no files in the project — these instructions never attach`,
          "update the pattern to the current tree layout, or remove it"
        )
      );
    }
  }
}
