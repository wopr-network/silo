#!/usr/bin/env bash
# Gate: check-design-posted — verify design spec comment on Linear issue
# Usage: gates/check-design-posted.sh <linear-issue-id>
set -euo pipefail

LINEAR_ID="${1:?Usage: check-design-posted.sh <linear-issue-id>}"
LINEAR_API_KEY="${LINEAR_API_KEY:?LINEAR_API_KEY env var is required}"

PAYLOAD=$(jq -n --arg id "$LINEAR_ID" '{
  "query": "query($id: String!) { issue(id: $id) { comments { nodes { body } } } }",
  "variables": {"id": $id}
}')
RESPONSE=$(curl -s -f -X POST "https://api.linear.app/graphql" \
  -H "Authorization: Bearer ${LINEAR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>&1) || {
  echo "Failed to query Linear API: $RESPONSE"
  exit 1
}

if echo "$RESPONSE" | jq -e '.errors' > /dev/null 2>&1; then
  echo "GraphQL error: $(echo "$RESPONSE" | jq -r '.errors[0].message // "unknown"')"
  exit 1
fi

if [ "$(echo "$RESPONSE" | jq '.data.issue')" = "null" ]; then
  echo "ERROR: Linear issue $LINEAR_ID not found"
  exit 1
fi

COMMENTS=$(echo "$RESPONSE" | jq -r '.data.issue.comments.nodes[].body // empty')

if echo "$COMMENTS" | grep -qiE '(palette|typography|responsive|design spec|color scheme|breakpoint)'; then
  echo "Design comment found on issue $LINEAR_ID"
  exit 0
else
  echo "No design comment found on issue $LINEAR_ID"
  exit 1
fi
