/**
 * Checks for the Claude Code surface: `.claude/settings.json` (+ the
 * `.local` variant), hooks, permissions, env, statusLine, slash commands,
 * agents, skills and `CLAUDE.md`. This is where the exec-bit and
 * dangling-hook checks live — the failure class that motivated cfgvet.
 */

import type { Finding } from "../types.js";
import { Project } from "../project.js";
import { parseFrontmatter } from "../frontmatter.js";
import { globMatches } from "../glob.js";
import { nearest } from "../nearest.js";
import { checkCommand, finding, isRecord, isStringArray, loadJsonFile } from "./context.js";

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
] as const;

export const KNOWN_SETTINGS_KEYS = [
  "$schema",
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "cleanupPeriodDays",
  "companyAnnouncements",
  "disabledMcpjsonServers",
  "enableAllProjectMcpServers",
  "enabledMcpjsonServers",
  "env",
  "forceLoginMethod",
  "forceLoginOrgUUID",
  "hooks",
  "includeCoAuthoredBy",
  "language",
  "model",
  "outputStyle",
  "permissions",
  "spinnerTipsEnabled",
  "statusLine",
] as const;

const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];

export function checkClaude(project: Project): Finding[] {
  const findings: Finding[] = [];

  const settings = checkSettingsFile(project, ".claude/settings.json", findings);
  const local = checkSettingsFile(project, ".claude/settings.local.json", findings);
  checkLocalOverrides(settings, local, findings);
  checkLocalGitignored(project, findings);
  checkInstructions(project, findings);
  checkSlashCommands(project, findings);
  checkAgents(project, findings);
  checkSkills(project, findings);

  return findings;
}

// ---------------------------------------------------------------------------
// settings.json
// ---------------------------------------------------------------------------

function checkSettingsFile(
  project: Project,
  file: string,
  findings: Finding[]
): Record<string, unknown> | undefined {
  if (!project.isFile(file)) return undefined;
  const { value, findings: loadFindings } = loadJsonFile(project, "claude", file);
  findings.push(...loadFindings);
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    findings.push(
      finding("E101", "claude", file, "", "top level must be a JSON object", "wrap the settings in { … }")
    );
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (!(KNOWN_SETTINGS_KEYS as readonly string[]).includes(key)) {
      const suggestion = nearest(key, KNOWN_SETTINGS_KEYS as readonly string[]);
      findings.push(
        finding(
          "W201",
          "claude",
          file,
          key,
          `unknown settings key "${key}" — the harness ignores it${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`,
          suggestion ? `rename "${key}" to "${suggestion}"` : `remove "${key}" or move it to the file that owns it`
        )
      );
    }
  }

  if ("hooks" in value) checkHooks(project, file, value["hooks"], findings);
  if ("permissions" in value) checkPermissions(file, value["permissions"], findings);
  if ("env" in value) checkEnv(file, value["env"], findings);
  if ("statusLine" in value) checkStatusLine(project, file, value["statusLine"], findings);

  return value;
}

function checkHooks(project: Project, file: string, hooks: unknown, findings: Finding[]): void {
  if (!isRecord(hooks)) {
    findings.push(
      finding("E105", "claude", file, "hooks", "hooks must be an object keyed by event name", "use { \"PreToolUse\": [ … ] }")
    );
    return;
  }
  for (const [event, groups] of Object.entries(hooks)) {
    const where = `hooks › ${event}`;
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      const suggestion = nearest(event, HOOK_EVENTS as readonly string[]);
      findings.push(
        finding(
          "E104",
          "claude",
          file,
          where,
          `"${event}" is not a hook event — these hooks will never fire${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`,
          suggestion ? `rename the event to "${suggestion}"` : `use one of: ${HOOK_EVENTS.join(", ")}`
        )
      );
      // Still validate the entries below so a rename fixes everything at once.
    }
    if (!Array.isArray(groups)) {
      findings.push(
        finding("E105", "claude", file, where, "event value must be an array of matcher groups", `use "${event}": [ { "hooks": [ … ] } ]`)
      );
      continue;
    }
    groups.forEach((group, gi) => {
      const gwhere = `${where}[${gi}]`;
      if (!isRecord(group)) {
        findings.push(finding("E105", "claude", file, gwhere, "matcher group must be an object", 'use { "matcher": "…", "hooks": [ … ] }'));
        return;
      }
      if ("matcher" in group && typeof group["matcher"] !== "string") {
        findings.push(finding("E105", "claude", file, `${gwhere} › matcher`, "matcher must be a string", 'use a tool-name pattern like "Bash" or "Edit|Write"'));
      }
      const entries = group["hooks"];
      if (!Array.isArray(entries)) {
        findings.push(
          finding("E105", "claude", file, gwhere, 'matcher group is missing its "hooks" array', 'add "hooks": [ { "type": "command", "command": "…" } ]')
        );
        return;
      }
      entries.forEach((entry, ei) => {
        const ewhere = `${gwhere} › hooks[${ei}]`;
        if (!isRecord(entry)) {
          findings.push(finding("E105", "claude", file, ewhere, "hook entry must be an object", 'use { "type": "command", "command": "…" }'));
          return;
        }
        if (entry["type"] !== "command") {
          findings.push(
            finding("E105", "claude", file, `${ewhere} › type`, `hook type must be "command", got ${JSON.stringify(entry["type"] ?? null)}`, 'set "type": "command"')
          );
        }
        const command = entry["command"];
        if (typeof command !== "string" || command.trim() === "") {
          findings.push(finding("E105", "claude", file, `${ewhere} › command`, "hook command must be a non-empty string", "set the shell command to run"));
          return;
        }
        if ("timeout" in entry && typeof entry["timeout"] !== "number") {
          findings.push(finding("E105", "claude", file, `${ewhere} › timeout`, "timeout must be a number (seconds)", 'use e.g. "timeout": 30'));
        }
        findings.push(
          ...checkCommand(project, command, { harness: "claude", file, where: `${ewhere} › command`, mode: "shell" })
        );
      });
    });
  }
}

function checkPermissions(file: string, permissions: unknown, findings: Finding[]): void {
  if (!isRecord(permissions)) {
    findings.push(finding("E109", "claude", file, "permissions", "permissions must be an object", 'use { "allow": [ … ], "deny": [ … ] }'));
    return;
  }
  for (const list of ["allow", "deny", "ask"] as const) {
    if (!(list in permissions)) continue;
    const rules = permissions[list];
    const where = `permissions › ${list}`;
    if (!isStringArray(rules)) {
      findings.push(
        finding("E109", "claude", file, where, `permissions.${list} must be an array of strings`, 'use rules like "Bash(npm run test:*)"')
      );
      continue;
    }
    rules.forEach((rule, i) => {
      const problem = permissionRuleProblem(rule);
      if (problem !== null) {
        findings.push(
          finding("W207", "claude", file, `${where}[${i}]`, `rule ${JSON.stringify(rule)} ${problem} — it will never match`, "write rules as Tool or Tool(specifier)")
        );
      }
    });
  }
  if ("additionalDirectories" in permissions && !isStringArray(permissions["additionalDirectories"])) {
    findings.push(
      finding("E109", "claude", file, "permissions › additionalDirectories", "additionalDirectories must be an array of strings", 'use e.g. ["../shared"]')
    );
  }
  if ("defaultMode" in permissions) {
    const mode = permissions["defaultMode"];
    if (typeof mode !== "string" || !PERMISSION_MODES.includes(mode)) {
      findings.push(
        finding(
          "E109",
          "claude",
          file,
          "permissions › defaultMode",
          `defaultMode must be one of ${PERMISSION_MODES.join(" | ")}, got ${JSON.stringify(mode)}`,
          'use e.g. "defaultMode": "acceptEdits"'
        )
      );
    }
  }
}

/** Returns a description of what is wrong with a permission rule, or null. */
export function permissionRuleProblem(rule: string): string | null {
  if (rule !== rule.trim()) return "has leading or trailing whitespace";
  if (rule === "") return "is empty";
  const open = rule.indexOf("(");
  if (open < 0) {
    if (rule.includes(")")) return "has an unmatched `)`";
    return null;
  }
  if (!rule.endsWith(")")) return "does not end with `)`";
  const tool = rule.slice(0, open);
  if (tool === "") return "has no tool name before `(`";
  const specifier = rule.slice(open + 1, -1);
  if (specifier === "") return "has an empty specifier";
  // A nested unbalanced paren means the closing paren we matched is wrong.
  let depth = 1;
  for (const ch of rule.slice(open + 1)) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) break;
  }
  if (depth !== 0) return "has unbalanced parentheses";
  return null;
}

function checkEnv(file: string, env: unknown, findings: Finding[]): void {
  if (!isRecord(env)) {
    findings.push(finding("E110", "claude", file, "env", "env must be an object of string values", 'use { "FOO": "bar" }'));
    return;
  }
  for (const [key, val] of Object.entries(env)) {
    if (typeof val !== "string") {
      findings.push(
        finding("E110", "claude", file, `env › ${key}`, `env values must be strings, got ${JSON.stringify(val)}`, `quote it: "${key}": "${String(val)}"`)
      );
    }
  }
}

function checkStatusLine(project: Project, file: string, statusLine: unknown, findings: Finding[]): void {
  if (!isRecord(statusLine)) return;
  if (statusLine["type"] === "command" && typeof statusLine["command"] === "string") {
    findings.push(
      ...checkCommand(project, statusLine["command"], { harness: "claude", file, where: "statusLine › command", mode: "shell" })
    );
  }
}

// ---------------------------------------------------------------------------
// Local overrides + gitignore
// ---------------------------------------------------------------------------

function checkLocalOverrides(
  shared: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  findings: Finding[]
): void {
  if (!shared || !local) return;
  const overridden = Object.keys(local)
    .filter((k) => k !== "$schema" && k in shared)
    .sort();
  if (overridden.length > 0) {
    findings.push(
      finding(
        "I303",
        "claude",
        ".claude/settings.local.json",
        overridden.join(", "),
        `overrides ${overridden.length === 1 ? "a key" : "keys"} also set in settings.json: ${overridden.join(", ")}`,
        "expected if intentional — local wins; remove the local copy to fall back to the shared value"
      )
    );
  }
}

function checkLocalGitignored(project: Project, findings: Finding[]): void {
  const localFile = ".claude/settings.local.json";
  if (!project.isFile(localFile)) return;
  const gitignore = project.readText(".gitignore");
  if (gitignore !== undefined && gitignoreCovers(gitignore, localFile)) return;
  findings.push(
    finding(
      "W210",
      "claude",
      localFile,
      "",
      "exists but nothing in .gitignore covers it — the next git add -A commits your personal settings",
      "add `.claude/settings.local.json` to .gitignore"
    )
  );
}

/** Simplified gitignore matching, good enough for a coverage warning. */
export function gitignoreCovers(gitignore: string, file: string): boolean {
  for (const raw of gitignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    if (globMatches(line, file)) return true;
    // A pattern naming a directory covers everything under it.
    if (!line.endsWith("/") && globMatches(line + "/**", file)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Instructions, slash commands, agents, skills
// ---------------------------------------------------------------------------

function checkInstructions(project: Project, findings: Finding[]): void {
  for (const file of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    if (!project.isFile(file)) continue;
    const text = project.readText(file);
    if (text !== undefined && text.trim() === "") {
      findings.push(
        finding("W206", "claude", file, "", "instructions file is empty — it loads on every session and says nothing", "write the project conventions, or delete the file")
      );
    }
  }
}

function checkSlashCommands(project: Project, findings: Finding[]): void {
  for (const file of project.filesUnder(".claude/commands", (n) => n.endsWith(".md"))) {
    const text = project.readText(file);
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    if (!fm.ok) {
      findings.push(finding("E108", "claude", file, `line ${fm.line}`, fm.error, "close the frontmatter block with a second --- line"));
      continue;
    }
    if (fm.body.trim() === "") {
      findings.push(finding("W206", "claude", file, "", "slash command has an empty body — invoking it sends an empty prompt", "write the command prompt below the frontmatter"));
    }
  }
}

function checkAgents(project: Project, findings: Finding[]): void {
  for (const file of project.filesUnder(".claude/agents", (n) => n.endsWith(".md"))) {
    const text = project.readText(file);
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    if (!fm.ok) {
      findings.push(finding("E108", "claude", file, `line ${fm.line}`, fm.error, "close the frontmatter block with a second --- line"));
      continue;
    }
    const missing = ["name", "description"].filter(
      (k) => typeof fm.data[k] !== "string" || (fm.data[k] as string).trim() === ""
    );
    if (fm.absent || missing.length > 0) {
      findings.push(
        finding(
          "W211",
          "claude",
          file,
          "",
          fm.absent
            ? "agent file has no frontmatter — it cannot be listed or delegated to"
            : `agent frontmatter is missing ${missing.join(" and ")}`,
          "add frontmatter with `name:` and `description:`"
        )
      );
    }
  }
}

function checkSkills(project: Project, findings: Finding[]): void {
  for (const entry of project.listDir(".claude/skills")) {
    if (!entry.dir) continue;
    const dir = `.claude/skills/${entry.name}`;
    const skillFile = `${dir}/SKILL.md`;
    if (!project.isFile(skillFile)) {
      findings.push(
        finding("E107", "claude", dir, "", "skill directory has no SKILL.md — the skill is invisible", `create ${skillFile} with name and description frontmatter`)
      );
      continue;
    }
    const text = project.readText(skillFile);
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    if (!fm.ok) {
      findings.push(finding("E108", "claude", skillFile, `line ${fm.line}`, fm.error, "close the frontmatter block with a second --- line"));
      continue;
    }
    const missing = ["name", "description"].filter(
      (k) => typeof fm.data[k] !== "string" || (fm.data[k] as string).trim() === ""
    );
    if (fm.absent || missing.length > 0) {
      findings.push(
        finding(
          "E107",
          "claude",
          skillFile,
          "",
          fm.absent ? "SKILL.md has no frontmatter" : `SKILL.md frontmatter is missing ${missing.join(" and ")}`,
          "add frontmatter with `name:` and `description:` — without them the skill is never surfaced"
        )
      );
    } else if (typeof fm.data["name"] === "string" && fm.data["name"] !== entry.name) {
      findings.push(
        finding(
          "E107",
          "claude",
          skillFile,
          "name",
          `frontmatter name "${fm.data["name"]}" does not match the directory name "${entry.name}"`,
          `set name: ${entry.name} (the directory name is the skill's identity)`
        )
      );
    }
  }
}
