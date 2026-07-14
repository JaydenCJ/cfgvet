/**
 * The rule catalog. Codes are stable API: once shipped, a code is never
 * renumbered or repurposed. Errors (E1xx) mean something is broken right
 * now — a hook that cannot run, a file the harness cannot parse. Warnings
 * (W2xx) mean the harness will silently ignore or mishandle something.
 * Info (I3xx) surfaces cross-harness drift and overrides worth knowing
 * about, without failing a pipeline by default.
 */

import type { Severity } from "./types.js";

export interface Rule {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
}

export const RULES: readonly Rule[] = [
  {
    code: "E101",
    severity: "error",
    title: "config file is not valid JSON",
    detail:
      "The harness cannot read this file at all, so every setting in it is dead. cfgvet reports the exact line and column of the first syntax error. Files VS Code owns (.vscode/mcp.json) are parsed as JSONC — comments and trailing commas are fine there, but nowhere else.",
  },
  {
    code: "E102",
    severity: "error",
    title: "referenced file does not exist",
    detail:
      "A hook command, statusLine command, @-file reference or MCP server binary points at a path that is not in the project. The harness discovers this mid-session, fails the hook or server silently, and keeps going — this is the classic broken-hook failure mode cfgvet exists to catch. $CLAUDE_PROJECT_DIR is resolved to the scanned root before checking.",
  },
  {
    code: "E103",
    severity: "error",
    title: "hook script is not executable",
    detail:
      "The script exists but its exec bit is off, so invoking it directly fails with EACCES. Scripts run through an interpreter (bash x.sh, node x.js) are exempt because the interpreter, not the kernel, opens the file.",
  },
  {
    code: "E104",
    severity: "error",
    title: "unknown hook event",
    detail:
      "Hook events are a fixed vocabulary (PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop, PreCompact, SessionStart, SessionEnd). A misspelled event is never fired and the hook silently never runs; cfgvet suggests the nearest real event.",
  },
  {
    code: "E105",
    severity: "error",
    title: "malformed hook entry",
    detail:
      "Hook entries must be arrays of matcher groups, each with a `hooks` array of `{type: \"command\", command: string}` objects. Wrong nesting is the most common hand-edit mistake and the harness discards the entry without a message.",
  },
  {
    code: "E106",
    severity: "error",
    title: "malformed MCP server entry",
    detail:
      "A stdio server needs a string `command` (args: array of strings, env: string map); an sse/http server needs a string `url`. Anything else means the server never starts. Applies to .mcp.json, .cursor/mcp.json and .vscode/mcp.json alike.",
  },
  {
    code: "E107",
    severity: "error",
    title: "broken skill",
    detail:
      "A directory under .claude/skills/ must contain a SKILL.md whose frontmatter declares `name` and `description` — that metadata is how the skill gets surfaced. A skill folder without them is invisible.",
  },
  {
    code: "E108",
    severity: "error",
    title: "broken frontmatter",
    detail:
      "The frontmatter block opened with --- but never closed, or a line inside it cannot be parsed. The harness will treat the whole header as body text and every attribute in it (globs, description, applyTo) is lost.",
  },
  {
    code: "E109",
    severity: "error",
    title: "malformed permissions block",
    detail:
      "permissions.allow / .deny / .ask must be arrays of strings, defaultMode one of default | acceptEdits | plan | bypassPermissions, additionalDirectories an array of strings. A wrong shape here can silently drop a deny rule — the worst possible direction to fail in.",
  },
  {
    code: "E110",
    severity: "error",
    title: "non-string env value",
    detail:
      "Values under settings `env` are exported into the session environment and must be strings. Numbers and booleans read fine in JSON but are rejected by the harness.",
  },
  {
    code: "W201",
    severity: "warning",
    title: "unknown settings key",
    detail:
      "The top-level key is not one the harness reads, so the whole block under it is inert. Usually a typo (cfgvet suggests the nearest real key) or a key that belongs in a different file.",
  },
  {
    code: "W202",
    severity: "warning",
    title: "MCP server drift across harnesses",
    detail:
      "The same server name is configured for two harnesses with a different command, args or URL. Teammates on different tools now talk to different backends under one name; usually one side was updated and the other forgotten.",
  },
  {
    code: "W203",
    severity: "warning",
    title: "legacy .cursorrules file",
    detail:
      ".cursorrules is deprecated in favor of .cursor/rules/*.mdc. It still loads today, but it cannot scope by glob, and projects that carry both often end up with contradictory instructions.",
  },
  {
    code: "W204",
    severity: "warning",
    title: "glob matches nothing",
    detail:
      "A Cursor rule `globs` entry or a Copilot `applyTo` pattern matches zero files in the project, so the rule never attaches. Typically the tree was refactored after the rule was written.",
  },
  {
    code: "W205",
    severity: "warning",
    title: "rule can never activate",
    detail:
      "A .mdc rule with no `alwaysApply: true`, no `globs` and no `description` has no activation path: it is never auto-attached and the agent has no description to select it by.",
  },
  {
    code: "W206",
    severity: "warning",
    title: "empty instructions",
    detail:
      "An instructions file (CLAUDE.md, .github/copilot-instructions.md, a rule body) exists but is empty or whitespace-only. It occupies the slot, reads as configured, and contributes nothing.",
  },
  {
    code: "W207",
    severity: "warning",
    title: "malformed permission rule",
    detail:
      "Permission rules are `Tool` or `Tool(specifier)`. Unbalanced parentheses, an empty specifier, or leading/trailing whitespace make the rule match nothing — dangerous when the rule was meant to *deny*.",
  },
  {
    code: "W208",
    severity: "warning",
    title: "machine-specific absolute path",
    detail:
      "A hook or server command points into one person's home directory or drive. It works on the author's machine and breaks for everyone who clones the repo; use $CLAUDE_PROJECT_DIR or a relative path.",
  },
  {
    code: "W209",
    severity: "warning",
    title: "script has no shebang",
    detail:
      "A directly-invoked hook script has no #! line, so the kernel cannot pick an interpreter and execution falls back to platform-dependent behavior. Add `#!/usr/bin/env bash` (or the right interpreter).",
  },
  {
    code: "W210",
    severity: "warning",
    title: "local settings not gitignored",
    detail:
      ".claude/settings.local.json is per-machine by design and often carries private allowlists. Nothing in .gitignore covers it, so the next `git add -A` publishes it to the whole team.",
  },
  {
    code: "W211",
    severity: "warning",
    title: "agent missing metadata",
    detail:
      "A .claude/agents/*.md file needs `name` and `description` frontmatter; without them the agent cannot be listed or delegated to. The file loads, then never gets used.",
  },
  {
    code: "W212",
    severity: "warning",
    title: "duplicate JSON key",
    detail:
      "The same key appears twice in one object; JSON parsers keep the last one and drop the first without a sound. In agent config the dropped entry is typically a hook or an MCP server someone believes is active.",
  },
  {
    code: "I301",
    severity: "info",
    title: "MCP server on one harness only",
    detail:
      "A server is configured for one harness while another harness in the same repo has an MCP file without it. Sometimes intentional; often the reason 'it works in my editor but not yours'.",
  },
  {
    code: "I302",
    severity: "info",
    title: "instructions parity gap",
    detail:
      "One active harness has project instructions and another has none at all. Teams that mix tools usually want at least a stub on each side pointing at the canonical instructions file.",
  },
  {
    code: "I303",
    severity: "info",
    title: "local override of a shared setting",
    detail:
      "settings.local.json redefines a key that settings.json also sets. Local wins by design — this is a heads-up for the debugging session where the shared value mysteriously does not apply.",
  },
];

const BY_CODE = new Map(RULES.map((r) => [r.code.toLowerCase(), r]));

export function ruleByCode(code: string): Rule | undefined {
  return BY_CODE.get(code.toLowerCase());
}
