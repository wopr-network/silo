#!/usr/bin/env bash
# Gate: ci-green — wait for CI checks to pass on a PR
# Usage: gates/ci-green.sh <pr-number> <repo>
set -euo pipefail

PR="${1:?Usage: ci-green.sh <pr-number> <repo>}"
REPO="${2:?Usage: ci-green.sh <pr-number> <repo>}"

gh pr checks "$PR" --repo "$REPO" --watch --fail-fast 2>&1
