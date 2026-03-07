#!/usr/bin/env bash
# Gate: merge-queue — watch PR through merge queue
# Usage: gates/merge-queue.sh <pr-number> <repo>
set -euo pipefail

PR="${1:?Usage: merge-queue.sh <pr-number> <repo>}"
REPO="${2:?Usage: merge-queue.sh <pr-number> <repo>}"

WATCH_SCRIPT="${WOPR_PR_WATCH_SCRIPT:-${WOPR_SCRIPTS_DIR:-$HOME}/wopr-pr-watch.sh}"
if [ ! -x "$WATCH_SCRIPT" ]; then
  echo "ERROR: WOPR_PR_WATCH_SCRIPT not found or not executable: $WATCH_SCRIPT" >&2
  exit 1
fi
"$WATCH_SCRIPT" "$PR" "$REPO" 2>&1
