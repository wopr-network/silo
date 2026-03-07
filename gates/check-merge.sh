#!/usr/bin/env bash
# Gate: check-merge — poll PR until merged, fail on CI failure in merge queue
# Usage: gates/check-merge.sh <pr-number> <repo>
# Timeout is handled by defcon's gate evaluator (execFile timeout).
set -euo pipefail

PR="${1:?Usage: check-merge.sh <pr-number> <repo>}"
REPO="${2:?Usage: check-merge.sh <pr-number> <repo>}"

# Trap SIGTERM from gate evaluator timeout for clean exit
trap 'echo "Timed out waiting for PR #$PR to merge"; exit 1' TERM

while true; do
  STATUS=$(gh pr view "$PR" --repo "$REPO" --json state,mergeStateStatus --jq '{state: .state, mergeStateStatus: .mergeStateStatus}' 2>&1) || {
    echo "Failed to query PR status: $STATUS"
    sleep 30
    continue
  }

  STATE=$(echo "$STATUS" | jq -r '.state')
  MERGE_STATUS=$(echo "$STATUS" | jq -r '.mergeStateStatus')

  case "$STATE" in
    MERGED)
      echo "PR #$PR merged in $REPO"
      exit 0
      ;;
    CLOSED)
      echo "PR #$PR was closed without merging in $REPO"
      exit 1
      ;;
  esac

  # Check for CI failure in merge queue
  if [ "$MERGE_STATUS" = "DIRTY" ] || [ "$MERGE_STATUS" = "BLOCKED" ]; then
    CHECKS=$(gh pr checks "$PR" --repo "$REPO" 2>&1 || true)
    if echo "$CHECKS" | grep -qE '(fail|FAIL)'; then
      echo "CI failing in merge queue for PR #$PR: $CHECKS"
      exit 1
    fi
  fi

  sleep 30
done
