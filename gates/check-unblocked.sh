#!/usr/bin/env bash
# Gate: check-unblocked — verify all blockedBy issues have merged PRs
# Usage: gates/check-unblocked.sh <linear-issue-id>
set -euo pipefail

LINEAR_ID="${1:?Usage: check-unblocked.sh <linear-issue-id>}"
LINEAR_API_KEY="${LINEAR_API_KEY:?LINEAR_API_KEY env var is required}"

# Fetch inverse relations (issues that block this one)
PAYLOAD=$(jq -n --arg id "$LINEAR_ID" '{
  "query": "query($id: String!) { issue(id: $id) { relations { nodes { type relatedIssue { identifier attachments { nodes { url } } } } } } }",
  "variables": {"id": $id}
}')

RESPONSE=$(curl -s -f -X POST "https://api.linear.app/graphql" \
  -H "Authorization: ${LINEAR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>&1) || {
  echo "Failed to query Linear API: $RESPONSE"
  exit 1
}

if echo "$RESPONSE" | jq -e '.errors' > /dev/null 2>&1; then
  echo "GraphQL error: $(echo "$RESPONSE" | jq -r '.errors[0].message // "unknown"')"
  exit 1
fi

UNMERGED=()
while IFS= read -r blocker; do
  IDENTIFIER=$(echo "$blocker" | jq -r '.identifier')
  # Find GitHub PR URL in attachments
  PR_URL=$(echo "$blocker" | jq -r '.attachments.nodes[] | select(.url | test("github.com/.*/pull/")) | .url' | head -1)
  if [ -z "$PR_URL" ]; then
    UNMERGED+=("${IDENTIFIER} (no PR)")
    continue
  fi
  # Extract repo and PR number from URL
  REPO=$(echo "$PR_URL" | sed -n 's|.*github.com/\([^/]*/[^/]*\)/pull/.*|\1|p')
  PR_NUM=$(echo "$PR_URL" | sed -n 's|.*/pull/\([0-9]*\).*|\1|p')
  if [ -z "$REPO" ] || [ -z "$PR_NUM" ]; then
    UNMERGED+=("${IDENTIFIER} (bad PR URL)")
    continue
  fi
  STATE=$(gh pr view "$PR_NUM" --repo "$REPO" --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
  if [ "$STATE" != "MERGED" ]; then
    UNMERGED+=("${IDENTIFIER}")
  fi
done < <(echo "$RESPONSE" | jq -c '.data.issue.relations.nodes[] | select(.type == "blocks") | .relatedIssue')

if [ ${#UNMERGED[@]} -gt 0 ]; then
  echo "Blocked by unmerged: ${UNMERGED[*]}"
  exit 1
fi

echo "All blockers merged"
exit 0
