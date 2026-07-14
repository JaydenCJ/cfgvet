/**
 * Checks for the Cursor surface: `.cursor/rules/*.mdc` (frontmatter,
 * activation paths, dead globs, @-file references), the legacy
 * `.cursorrules` file, and rule bodies. `.cursor/mcp.json` is handled by
 * the shared MCP module.
 */

import type { Finding } from "../types.js";
import { Project } from "../project.js";
import { parseFrontmatter } from "../frontmatter.js";
import { globMatchesAny, splitGlobList } from "../glob.js";
import { finding } from "./context.js";

export function checkCursor(project: Project): Finding[] {
  const findings: Finding[] = [];
  checkLegacyRules(project, findings);
  for (const file of project.filesUnder(".cursor/rules", (n) => n.endsWith(".mdc"))) {
    checkRuleFile(project, file, findings);
  }
  return findings;
}

function checkLegacyRules(project: Project, findings: Finding[]): void {
  if (!project.isFile(".cursorrules")) return;
  findings.push(
    finding(
      "W203",
      "cursor",
      ".cursorrules",
      "",
      ".cursorrules is deprecated in favor of .cursor/rules/*.mdc",
      "move the content into .cursor/rules/<name>.mdc with a frontmatter block, then delete .cursorrules"
    )
  );
  const text = project.readText(".cursorrules");
  if (text !== undefined && text.trim() === "") {
    findings.push(finding("W206", "cursor", ".cursorrules", "", "legacy rules file is empty", "delete the empty file"));
  }
}

function checkRuleFile(project: Project, file: string, findings: Finding[]): void {
  const text = project.readText(file);
  if (text === undefined) return;
  const fm = parseFrontmatter(text);
  if (!fm.ok) {
    findings.push(finding("E108", "cursor", file, `line ${fm.line}`, fm.error, "close the frontmatter block with a second --- line"));
    return;
  }

  if (fm.body.trim() === "") {
    findings.push(
      finding("W206", "cursor", file, "", "rule body is empty — when the rule attaches it injects nothing", "write the rule text below the frontmatter")
    );
  }

  const alwaysApply = fm.data["alwaysApply"] === true;
  const description = typeof fm.data["description"] === "string" && (fm.data["description"] as string).trim() !== "";
  const globsRaw = fm.data["globs"];
  const globs =
    typeof globsRaw === "string" || Array.isArray(globsRaw) ? splitGlobList(globsRaw as string | string[]) : [];

  if (!alwaysApply && !description && globs.length === 0) {
    findings.push(
      finding(
        "W205",
        "cursor",
        file,
        "",
        "rule has no activation path: alwaysApply is not true, and there is no globs or description frontmatter",
        "add `globs:` to auto-attach by file type, `description:` for agent-requested use, or `alwaysApply: true`"
      )
    );
  }

  for (const pattern of globs) {
    if (!globMatchesAny(pattern, project.files)) {
      findings.push(
        finding(
          "W204",
          "cursor",
          file,
          `globs › ${pattern}`,
          `glob "${pattern}" matches no files in the project — the rule never auto-attaches through it`,
          "update the pattern to the current tree layout, or remove it"
        )
      );
    }
  }

  checkFileReferences(project, file, fm.body, findings);
}

/**
 * `.mdc` bodies can pull other files in with a line containing only
 * `@path/to/file`. A dangling reference makes Cursor inject the literal
 * `@…` text instead of the file — confusing and silent.
 */
function checkFileReferences(project: Project, file: string, body: string, findings: Finding[]): void {
  for (const rawLine of body.split(/\r?\n/)) {
    const m = /^@([^\s@]+)$/.exec(rawLine.trim());
    if (!m) continue;
    const ref = m[1] as string;
    // Only treat it as a file reference when it looks like a path.
    if (!ref.includes("/") && !ref.includes(".")) continue;
    if (!project.isFile(ref)) {
      findings.push(
        finding(
          "E102",
          "cursor",
          file,
          `@${ref}`,
          `references ${ref}, which does not exist — Cursor injects the literal text instead of the file`,
          `fix the path or remove the @${ref} line`
        )
      );
    }
  }
}
