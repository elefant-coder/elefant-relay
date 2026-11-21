#!/bin/bash
# The gate: everything that must pass before a commit is called done or a version is released.
#   harness/check.sh            all steps (≈6 min)
#   harness/check.sh --quick    typecheck + unit/integration tests only
# Results: harness/out/<time>/ (summary.md + each step's output). On success, harness/out/last-pass holds the commit.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$ROOT/harness/out/$STAMP"
mkdir -p "$OUT"
SHA=$(git rev-parse HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')   # untracked files count: app/renderer/** ships
QUICK=${1:-}
# never a real AI: a stand-in claude that records how it was called (the AI-to-AI checks read FAKE_LOG)
export PATH="$ROOT/app/test/fake:$PATH" FAKE_LOG="$OUT/fake-claude.jsonl"
fails=0
{ echo "# check $STAMP"; echo; echo "- commit: $SHA$( [ "$DIRTY" != 0 ] && echo " + $DIRTY uncommitted file(s)")"; echo; } > "$OUT/summary.md"

step() { # step <name> <command...>
  local name=$1; shift
  local t0=$SECONDS
  if "$@" > "$OUT/$name.log" 2>&1; then r=PASS; else r=FAIL; fails=$((fails + 1)); fi
  printf -- "- %s %s (%ss)\n" "$r" "$name" "$((SECONDS - t0))" | tee -a "$OUT/summary.md"
  [ $r = FAIL ] && tail -15 "$OUT/$name.log" | sed 's/^/    /' | tee -a "$OUT/summary.md"
  return 0
}

step typecheck npm run --silent typecheck
step unit npm test
if [ "$QUICK" != "--quick" ]; then
  step app-lib bash -c "cd app && npm run --silent lib"
  step pair node app/test/run-pair.mjs --out "$OUT/pair" --echo --connect
  step clicks node app/test/run-clicks.mjs --out "$OUT/clicks"
fi

echo | tee -a "$OUT/summary.md" >/dev/null
if [ $fails = 0 ]; then
  echo "PASS — $OUT" | tee -a "$OUT/summary.md"
  [ "$QUICK" != "--quick" ] && [ "$DIRTY" = 0 ] && echo "$SHA $STAMP" > "$ROOT/harness/out/last-pass"
  exit 0
fi
echo "FAIL ($fails step(s)) — $OUT" | tee -a "$OUT/summary.md"
exit 1
