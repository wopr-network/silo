#!/usr/bin/env bash
# Gate: spec-posted — verify architect spec comment exists on Linear issue
# Usage: gates/spec-posted.sh <linear-issue-id>
set -euo pipefail

LINEAR_ID="${1:?Usage: spec-posted.sh <linear-issue-id>}"

# Query Linear API for comments on the issue containing "Implementation Spec"
LINEAR_API_KEY="${LINEAR_API_KEY:?LINEAR_API_KEY env var is required}"
PAYLOAD=$(jq -n --arg id "$LINEAR_ID" '{"query": "query { issue(id: \($id)) { comments { nodes { body } } } }"}')
RESPONSE=$(curl -s -f -X POST "https://api.linear.app/graphql" \
  -H "Authorization: ${LINEAR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>&1) || {
  echo "Failed to query Linear API: $RESPONSE"
  exit 1
}
if echo "$RESPONSE" | jq -e '.errors' > /dev/null 2>&1; then
  echo "GraphQL error from Linear API: $(echo "$RESPONSE" | jq -r '.errors[0].message // "unknown error"')"
  exit 1
fi

COMMENTS=$(echo "$RESPONSE" | jq -r '.data.issue.comments.nodes[].body // empty')

if echo "$COMMENTS" | grep -q "Implementation Spec"; then
  echo "Spec comment found on issue $LINEAR_ID"
  exit 0
else
  echo "No spec comment found on issue $LINEAR_ID"
  exit 1
fi
