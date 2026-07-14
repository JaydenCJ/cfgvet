#!/usr/bin/env bash
# Minimal CI gate: fail the build on agent-config errors/warnings, keep
# the JSON report as a build artifact. Usage: bash examples/ci-gate.sh [dir]
set -euo pipefail

DIR="${1:-.}"
REPORT="${REPORT:-cfgvet-report.json}"

# Machine-readable report for the build archive (never fails the step).
cfgvet check "$DIR" --format json --fail-on never > "$REPORT"

# The actual gate: errors and warnings block, info-level notes do not.
if ! cfgvet check "$DIR" --fail-on warning; then
  echo "agent config is broken — see the findings above (full report: $REPORT)" >&2
  exit 1
fi

echo "agent config OK (report: $REPORT)"
