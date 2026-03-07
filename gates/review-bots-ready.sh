#!/usr/bin/env bash
# Gate: review-bots-ready — wait for review bots to post
# Usage: gates/review-bots-ready.sh <pr-number> <repo>
set -euo pipefail

PR="${1:?Usage: review-bots-ready.sh <pr-number> <repo>}"
REPO="${2:?Usage: review-bots-ready.sh <pr-number> <repo>}"

"${WOPR_AWAIT_REVIEWS_SCRIPT:-${WOPR_SCRIPTS_DIR:-$HOME}/wopr-await-reviews.sh}" "$PR" "$REPO" 2>&1
