#!/usr/bin/env bash
# Smoke test for cfgvet: exercises the real CLI end to end against the
# bundled example projects and a freshly seeded temp project. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in check list explain --fail-on --format --harness "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 (distinct from findings' exit 1).
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI check "$WORKDIR/does-not-exist" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing dir should exit 2"; }
$CLI check . --fail-on sometimes >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad --fail-on should exit 2"; }
$CLI explain E999 >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown explain topic should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. The broken example fails with the seeded findings.
set +e
BROKEN_OUT="$($CLI check examples/broken)"; BROKEN_CODE=$?
set -e
[ "$BROKEN_CODE" -eq 1 ] || fail "examples/broken should exit 1, got $BROKEN_CODE"
echo "$BROKEN_OUT" | grep -q '6 errors, 7 warnings, 3 info' || fail "broken counts wrong"
for needle in E102 E103 E104 E107 W201 W202 W203 W204 W210 I301 I302 I303; do
  echo "$BROKEN_OUT" | grep -q "$needle" || fail "broken report missing $needle"
done
echo "$BROKEN_OUT" | grep -q 'did you mean "permissions"?' || fail "missing did-you-mean"
echo "$BROKEN_OUT" | grep -q 'chmod +x .claude/hooks/format.sh' || fail "missing exec-bit fix"
echo "[smoke] broken example ok (6 errors, 7 warnings)"

# 5. The fixed twin passes with zero findings across its harnesses.
$CLI check examples/clean >/dev/null || fail "examples/clean should exit 0"
CLEAN_OUT="$($CLI check examples/clean)"
echo "$CLEAN_OUT" | grep -q 'checking claude, cursor (' || fail "clean should detect claude and cursor"
echo "$CLEAN_OUT" | grep -q 'cfgvet: OK — 0 errors, 0 warnings, 0 info' || fail "clean should be spotless"
echo "[smoke] clean example ok (exit 0)"

# 6. --fail-on moves the gate; --harness narrows the scan.
set +e
$CLI check examples/broken --fail-on never >/dev/null 2>&1; [ $? -eq 0 ] || { set -e; fail "--fail-on never should exit 0"; }
$CLI check examples/broken --harness cursor >/dev/null 2>&1; CODE=$?
set -e
[ "$CODE" -eq 1 ] || fail "--harness cursor should still fail on the cursor findings"
CURSOR_OUT="$($CLI check examples/broken --harness cursor --fail-on never)"
echo "$CURSOR_OUT" | grep -q 'W203' || fail "--harness cursor should report W203"
echo "$CURSOR_OUT" | grep -q 'E103' && fail "--harness cursor must not run claude checks"
echo "[smoke] --fail-on / --harness ok"

# 7. JSON output is valid JSON with the stable shape.
set +e
JSON_OUT="$($CLI check examples/broken --format json)"; JSON_CODE=$?
set -e
[ "$JSON_CODE" -eq 1 ] || fail "json run should still exit 1"
echo "$JSON_OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.ok!==false||j.summary.errors!==6)throw new Error('bad shape')})" \
  || fail "--format json shape wrong"
echo "[smoke] JSON output ok"

# 8. list inventories every harness.
LIST_OUT="$($CLI list examples/broken)"
for needle in "claude:" "cursor:" "copilot:" ".mcp.json" ".cursorrules" ".vscode/mcp.json"; do
  echo "$LIST_OUT" | grep -q "$needle" || fail "list missing $needle"
done
echo "[smoke] list ok"

# 9. explain documents the catalog offline.
$CLI explain E103 | grep -q "exec bit" || fail "explain E103 failed"
$CLI explain codes | grep -c '^[EWI][0-9]' | grep -q '^25$' || fail "explain codes should list 25 rules"
echo "[smoke] explain ok"

# 10. Fix loop on a fresh temp project: E103 -> chmod -> clean.
mkdir -p "$WORKDIR/proj/.claude/hooks"
cat > "$WORKDIR/proj/.claude/settings.json" <<'EOF'
{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ".claude/hooks/bye.sh"}]}]}}
EOF
printf '#!/usr/bin/env bash\necho bye\n' > "$WORKDIR/proj/.claude/hooks/bye.sh"
chmod 644 "$WORKDIR/proj/.claude/hooks/bye.sh"
PROJ_OUT="$($CLI check "$WORKDIR/proj" || true)"
echo "$PROJ_OUT" | grep -q 'E103' || fail "temp project should report E103"
chmod +x "$WORKDIR/proj/.claude/hooks/bye.sh"
$CLI check "$WORKDIR/proj" >/dev/null || fail "temp project should be clean after chmod +x"
echo "[smoke] fix loop ok (E103 -> chmod +x -> clean)"

# 11. Determinism: two runs over the same tree are byte-identical.
$CLI check examples/broken > "$WORKDIR/run1.txt" 2>/dev/null || true
$CLI check examples/broken > "$WORKDIR/run2.txt" 2>/dev/null || true
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
