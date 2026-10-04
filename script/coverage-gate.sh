#!/usr/bin/env bash
# Coverage gate — constitution III / research R11 (task T008).
#
# Line coverage for CORE contracts (files under src/) must be >= 95%.
# test/ and script/ files are filtered out of the calculation, and an empty
# src/ (or an lcov report without src/ records) fails loudly instead of
# passing vacuously.
#
# Usage:
#   ./script/coverage-gate.sh                 # generates lcov.info via `forge coverage`
#   ./script/coverage-gate.sh path/to/lcov.info

set -euo pipefail

THRESHOLD=95
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LCOV_FILE="${1:-lcov.info}"

# 1. There must be core contracts to measure.
FIRST_SOL="$(find src -name '*.sol' -type f -print -quit 2>/dev/null || true)"
if [ -z "$FIRST_SOL" ]; then
  echo "ERROR: no Solidity sources found under src/ — nothing to measure." >&2
  exit 1
fi

# 2. Produce the lcov report if the caller did not hand us one.
if [ ! -f "$LCOV_FILE" ]; then
  echo "==> $LCOV_FILE not found — running 'forge coverage' (seeds from foundry.toml)"
  forge coverage --report lcov --report summary
fi

if [ ! -f "$LCOV_FILE" ]; then
  echo "ERROR: $LCOV_FILE was not produced by 'forge coverage'." >&2
  exit 1
fi

# 3. Sum DA:<line>,<hits> records for src/** only (drop test/, script/, lib/).
#    hits == '-' means non-executable line and is excluded from the denominator.
READ_OUT="$(awk '
  /^SF:/ {
    file = substr($0, 4)
    keep = (file ~ /(^|\/)src\// && file !~ /(^|\/)(test|script|lib|node_modules)\//) ? 1 : 0
    next
  }
  keep && /^DA:/ {
    split(substr($0, 4), pair, ",")
    if (pair[2] != "-") {
      total++
      if (pair[2] + 0 > 0) hit++
    }
  }
  END { printf "%d %d\n", hit + 0, total + 0 }
' "$LCOV_FILE")"

read -r HIT TOTAL <<<"$READ_OUT"

if [ "$TOTAL" -eq 0 ]; then
  echo "ERROR: no line-coverage records under src/ in $LCOV_FILE." >&2
  exit 1
fi

COVERAGE="$(awk -v h="$HIT" -v t="$TOTAL" 'BEGIN { printf "%.2f", (h * 100) / t }')"
echo "Core (src/) line coverage: ${COVERAGE}% (${HIT}/${TOTAL} executable lines) — gate: ${THRESHOLD}%"

if awk -v c="$COVERAGE" -v g="$THRESHOLD" 'BEGIN { exit !(c + 0 < g + 0) }'; then
  echo "ERROR: line coverage ${COVERAGE}% is below the ${THRESHOLD}% gate." >&2
  exit 1
fi

echo "Coverage gate passed."
