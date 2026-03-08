#!/usr/bin/env bash
# Gate: check-review-ready — CI green AND bot reviewers posted
# Usage: gates/check-review-ready.sh <pr-number> <repo>
set -euo pipefail

PR="${1:?Usage: check-review-ready.sh <pr-number> <repo>}"
REPO="${2:?Usage: check-review-ready.sh <pr-number> <repo>}"

# Check 1: All CI checks passing
echo "Checking CI status..."
CHECKS=$(gh pr view "$PR" --repo "$REPO" --json statusCheckRollup --jq '.statusCheckRollup' 2>/dev/null) || { echo "ERROR: failed to query statusCheckRollup for PR #$PR"; exit 1; }
FAILING=$(echo "$CHECKS" | jq -r '[.[] | select(.conclusion == "FAILURE") | .name] | .[]' 2>/dev/null)
if [ -n "$FAILING" ]; then
  echo "CI checks failing for PR #$PR in $REPO: $FAILING"
  exit 1
fi
PENDING=$(echo "$CHECKS" | jq -r '[.[] | select(.status == "IN_PROGRESS" or .status == "QUEUED" or .status == "PENDING") | .name] | .[]' 2>/dev/null)
if [ -n "$PENDING" ]; then
  echo "CI checks still pending for PR #$PR in $REPO: $PENDING"
  exit 1
fi
echo "CI checks passed"

# Check 2: Bot reviewers posted
echo "Checking for review bot comments..."
COMMENTS=$(gh api "repos/$REPO/issues/$PR/comments" --jq '.[].user.login' 2>/dev/null || echo "")
PR_COMMENTS=$(gh api "repos/$REPO/pulls/$PR/comments" --jq '.[].user.login' 2>/dev/null || echo "")
REVIEWS=$(gh api "repos/$REPO/pulls/$PR/reviews" --jq '.[].user.login' 2>/dev/null || echo "")
ALL_AUTHORS=$(printf '%s\n%s\n%s' "$COMMENTS" "$PR_COMMENTS" "$REVIEWS" | sort -u)

BOTS_FOUND=0
BOTS_MISSING=()
for BOT in "qodo-code-review[bot]" "coderabbitai[bot]" "sourcery-ai[bot]" "devin-ai-integration[bot]"; do
  if echo "$ALL_AUTHORS" | grep -qF "$BOT"; then
    BOTS_FOUND=$((BOTS_FOUND + 1))
  else
    BOTS_MISSING+=("$BOT")
  fi
done

if [ "$BOTS_FOUND" -eq 0 ]; then
  echo "No review bots have posted on PR #$PR: missing ${BOTS_MISSING[*]}"
  exit 1
fi

echo "Review ready: CI green, $BOTS_FOUND bot(s) posted"
exit 0
