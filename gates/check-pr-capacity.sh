#!/usr/bin/env bash
# Gate: check-pr-capacity — exit 0 if open PR count < max
# Usage: gates/check-pr-capacity.sh <repo> [max]
set -euo pipefail

REPO="${1:?Usage: check-pr-capacity.sh <repo>}"
MAX="${2:-4}"

COUNT=$(gh pr list --repo "$REPO" --state open --json number --jq 'length')

if [ "$COUNT" -lt "$MAX" ]; then
  echo "PR capacity OK: $COUNT open (max $MAX)"
  exit 0
else
  echo "PR capacity exceeded: $COUNT open (max $MAX)"
  exit 1
fi
