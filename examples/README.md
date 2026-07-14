# cfgvet examples

Two miniature multi-harness projects to run cfgvet against, plus a CI gate
script. Both are also exercised by `scripts/smoke.sh`.

## broken/

A project that uses Claude Code, Cursor and VS Code side by side, seeded
with the classic failure modes cfgvet exists to catch — every one of them
silent in the respective tool:

| Seeded problem | Rule |
|---|---|
| `permisions` typo in `.claude/settings.json` | W201 |
| Hook event `postToolUse` (lowercase p) | E104 |
| Hook points at `.claude/hooks/lint.sh`, which does not exist | E102 |
| `.claude/hooks/format.sh` exists but is not executable | E103 |
| Skill directory without a `SKILL.md` | E107 |
| `.claude/settings.local.json` not gitignored, overriding `env` | W210, I303 |
| Legacy `.cursorrules` next to `.cursor/rules/` | W203 |
| Rule glob `services/**/*.go` matching nothing | W204 |
| Dangling `@templates/service-template.ts` reference | E102 |
| MCP server `db` pinned to different versions per harness | W202 |
| MCP server `docs` configured for Claude only | I301 |
| Copilot active (`.vscode/mcp.json`) but has no instructions | I302 |

```bash
cfgvet check examples/broken          # exits 1: 6 errors, 7 warnings, 3 info
```

## clean/

The same project with everything fixed: exits 0 with zero findings.
Diff the two directories to see what "fixed" looks like.

```bash
cfgvet check examples/clean           # exits 0
```

## ci-gate.sh

A minimal pipeline gate: fails the build on errors and warnings but lets
info-level parity notes through, and archives the JSON report.

```bash
bash examples/ci-gate.sh examples/clean
```
