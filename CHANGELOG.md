# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `cfgvet check`: scans a project root for the configuration of three
  agent harnesses — Claude Code (`.claude/`, `CLAUDE.md`, `.mcp.json`),
  Cursor (`.cursor/`, `.cursorrules`) and GitHub Copilot
  (`.github/copilot-instructions.md`, `.github/instructions/`,
  `.vscode/mcp.json`) — and grades them with a 25-rule catalog.
- Position-aware JSON parser: syntax errors carry the exact line and
  column (E101), duplicate keys are reported instead of silently
  collapsed (W212), and `__proto__` keys cannot pollute prototypes.
  `.vscode/mcp.json` is parsed as JSONC (comments, trailing commas) —
  and only that file, matching VS Code's actual behavior.
- Hook validation for `.claude/settings.json`: event-name vocabulary
  with did-you-mean (E104), matcher-group structure (E105), and command
  analysis — dangling script paths (E102), missing exec bits (E103),
  missing shebangs (W209), machine-specific absolute paths (W208) —
  with `$CLAUDE_PROJECT_DIR` resolved and unresolvable `$VARS` skipped,
  never guessed at.
- Settings schema checks: unknown top-level keys with did-you-mean
  (W201), permissions shape and `Tool(specifier)` rule syntax
  (E109/W207), non-string `env` values (E110), `statusLine` command
  paths, `settings.local.json` gitignore coverage (W210) and local
  overrides of shared keys (I303).
- Markdown-config checks: frontmatter parsing for `.mdc`, agent, skill
  and instructions files (E108), Cursor rules with no activation path
  (W205), dead `globs`/`applyTo` patterns (W204), dangling `@file`
  references (E102), empty instructions/bodies (W206), legacy
  `.cursorrules` (W203), agents without metadata (W211) and skills
  without a valid `SKILL.md` (E107).
- Cross-harness MCP view: entry validation for all three server files
  (E106), same-name servers drifting apart across harnesses (W202),
  servers configured on one side only (I301), and an instructions
  parity check across active harnesses (I302).
- CLI surface: `check` (default), `list` inventory, `explain` for every
  rule code offline; `--fail-on error|warning|info|never` (default
  warning), `--format json` with a stable shape, `--harness` filtering,
  `--quiet`, and exit codes 0 (clean) / 1 (findings) / 2 (usage error).
- Public programmatic API (`scan`, `discover`, `parseJson`,
  `parseFrontmatter`, `globMatches`, `checkCommand`, renderers) with
  type declarations.
- Test suite: 90 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh` against the bundled
  broken / clean example projects.

[0.1.0]: https://github.com/JaydenCJ/cfgvet/releases/tag/v0.1.0
