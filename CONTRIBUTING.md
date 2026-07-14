# Contributing to cfgvet

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what it flags.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/cfgvet.git
cd cfgvet
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (check, list, explain, exit
codes, --fail-on, --harness, JSON output, the chmod-fix loop,
determinism) against the bundled example projects and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (parsing, matching and analysis take values or a `Project`
   handle — only the CLI touches process state).
5. New diagnostics need a row in `docs/rules.md`, a stable code that is
   never reused, an `explain` entry, and at least one test.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — cfgvet reads the scanned directory, then
  prints. That is the whole I/O surface.
- Rule codes (`E1xx`/`W2xx`/`I3xx`) are stable API: never renumber or
  repurpose an existing code; add new ones instead.
- Err on the side of silence: a check that cannot resolve what a config
  refers to (unset `$VARS`, `PATH` lookups, absolute system paths) skips
  rather than guesses. False positives train people to ignore the tool.
- Checks for a new harness must be additive: projects that do not use
  that harness must see zero new findings.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `cfgvet --version` output, the exact command line, and a
minimal config file (or `cfgvet check --format json` excerpt) that
reproduces the problem. If you believe a finding is wrong, say what the
harness actually does with that config — observed harness behavior is
the tiebreaker.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
