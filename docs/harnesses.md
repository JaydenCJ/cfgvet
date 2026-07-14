# What cfgvet reads, per harness

cfgvet only checks harnesses it detects in the scanned root (or the
subset you pass with `--harness`). Detection and file inventory:

## Claude Code

| File | What is checked |
|---|---|
| `.claude/settings.json`, `.claude/settings.local.json` | JSON validity, known keys, hooks (events, structure, command paths, exec bits, shebangs), permissions shape and rule syntax, `env` value types, `statusLine` command |
| `CLAUDE.md`, `.claude/CLAUDE.md` | present-but-empty |
| `.claude/hooks/*` | referenced scripts: existence, exec bit, shebang |
| `.claude/commands/**/*.md` | frontmatter parses, non-empty body |
| `.claude/agents/*.md` | frontmatter parses, `name` + `description` present |
| `.claude/skills/<name>/SKILL.md` | file exists, frontmatter has `name` + `description`, `name` matches the directory |
| `.mcp.json` | server entries, command paths, cross-harness drift/parity |
| `.gitignore` | must cover `.claude/settings.local.json` when it exists |

Hook events cfgvet accepts: `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`,
`SessionStart`, `SessionEnd`.

## Cursor

| File | What is checked |
|---|---|
| `.cursor/rules/**/*.mdc` | frontmatter parses, activation path exists (`alwaysApply` / `globs` / `description`), globs match real files, `@file` references resolve, non-empty body |
| `.cursorrules` | flagged as deprecated; present-but-empty |
| `.cursor/mcp.json` | server entries, command paths, cross-harness drift/parity |

## GitHub Copilot

| File | What is checked |
|---|---|
| `.github/copilot-instructions.md` | present-but-empty |
| `.github/instructions/*.instructions.md` | frontmatter parses, `applyTo` present, globs match real files, non-empty body |
| `.vscode/mcp.json` | parsed as JSONC (VS Code allows comments/trailing commas), `servers` map entries, drift/parity |

## Path and glob conventions

- All reported paths are root-relative with `/` separators, on every OS.
- Glob liveness (W204) is evaluated against a bounded walk of the project
  tree that skips `.git`, `node_modules`, `dist`, `build`, `target`,
  `__pycache__`, virtualenvs and other vendored/generated directories.
- A pattern with no `/` matches basenames anywhere (`*.ts` behaves as
  `**/*.ts`), matching how Cursor and gitignore treat bare patterns.
- Symlinks are not followed; harnesses resolve them inconsistently and
  following them could escape the scanned root.
