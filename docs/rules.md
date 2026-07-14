# cfgvet rule catalog

Codes are stable API: once shipped, a code is never renumbered or
repurposed. `cfgvet explain <code>` prints the same rationale offline.

Severity model:

- **E1xx — errors.** Something is broken *right now*: a file the harness
  cannot parse, a hook that cannot run, a server that cannot start.
- **W2xx — warnings.** The harness will silently ignore or mishandle
  something; the config lies about what is active.
- **I3xx — info.** Cross-harness drift and overrides worth knowing about;
  they do not fail the default gate.

## Errors

| Code | Title | Typical cause |
|---|---|---|
| E101 | config file is not valid JSON | hand-edit left a trailing comma; comments outside `.vscode/mcp.json` |
| E102 | referenced file does not exist | hook script moved/renamed; dangling `@file` in a `.mdc`; MCP script deleted |
| E103 | hook script is not executable | script created without `chmod +x`; exec bit lost in transit |
| E104 | unknown hook event | `postToolUse` instead of `PostToolUse` — events are case-sensitive |
| E105 | malformed hook entry | matcher group and hook entry nesting mixed up |
| E106 | malformed MCP server entry | missing `command`/`url`; `args` not a string array; wrong `servers` vs `mcpServers` key |
| E107 | broken skill | skill folder without `SKILL.md`, or missing/mismatched `name`/`description` |
| E108 | broken frontmatter | `---` opened but never closed; unparseable attribute line |
| E109 | malformed permissions block | `deny` given as a string; unknown `defaultMode` |
| E110 | non-string env value | `"DEBUG": true` — the harness only exports strings |

Notes:

- E102 resolves `$CLAUDE_PROJECT_DIR` (both spellings) to the scanned
  root before checking. Tokens containing other `$VARS` or backticks are
  skipped, never guessed at. Bare program names (`jq`, `npx`) are assumed
  to come from `PATH` and are out of scope, as are absolute system paths.
- E103 exempts scripts run through an interpreter (`bash x.sh`,
  `node x.js`): the interpreter opens the file, so the exec bit is not
  needed there.

## Warnings

| Code | Title | Typical cause |
|---|---|---|
| W201 | unknown settings key | typo (`permisions`); a key that belongs in a different file |
| W202 | MCP server drift across harnesses | one side updated to `db-mcp@2`, the other forgotten |
| W203 | legacy `.cursorrules` file | project predates `.cursor/rules/*.mdc` |
| W204 | glob matches nothing | tree refactored after the rule/`applyTo` was written |
| W205 | rule can never activate | `.mdc` without `alwaysApply`/`globs`/`description`; instructions without `applyTo` |
| W206 | empty instructions | placeholder file committed and forgotten |
| W207 | malformed permission rule | unbalanced parens, empty specifier, stray whitespace |
| W208 | machine-specific absolute path | `/home/<user>/…` or a `C:\Users\…` path in a shared config |
| W209 | script has no shebang | directly-invoked hook without a `#!` line |
| W210 | local settings not gitignored | `.claude/settings.local.json` about to be committed |
| W211 | agent missing metadata | `.claude/agents/*.md` without `name`/`description` frontmatter |
| W212 | duplicate JSON key | two `"env"` blocks — the first silently loses |

## Info

| Code | Title | Typical cause |
|---|---|---|
| I301 | MCP server on one harness only | server added to `.mcp.json` but not `.cursor/mcp.json` |
| I302 | instructions parity gap | `CLAUDE.md` exists, the Copilot side has nothing |
| I303 | local override of a shared setting | `settings.local.json` shadows a `settings.json` key |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | no findings at or above `--fail-on` (default gate: `warning`) |
| 1 | findings at or above `--fail-on` |
| 2 | usage or input error — a broken invocation, not a broken config |
