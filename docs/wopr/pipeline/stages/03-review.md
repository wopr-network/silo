# Stage 3: Review — The WOPR Implementation

> Implements: [method/pipeline/stages/03-review.md](../../../method/pipeline/stages/03-review.md)

---

## The 4-Layer Review in WOPR

### Layer 1: CI Gates (GitHub Actions)

```bash
gh pr checks <PR_NUMBER> --repo wopr-network/<repo>
```

Required checks vary by repo:
- **wopr**: Lint and Type Check, Build, Test
- **wopr-platform**: CI checks
- **wopr-plugin-***: varies

If ANY check is FAILING → report ISSUES immediately, no code review.

### Layer 2: Review Bots

WOPR uses 4 automated review bots:

| Bot | Username | What it does |
|-----|----------|-------------|
| **Qodo** | `qodo-code-review[bot]` | Posts `/improve` suggestions as inline comments. These are blocking. |
| **CodeRabbit** | `coderabbitai[bot]` | AI code review with inline suggestions |
| **Devin** | `devin-ai[bot]` | AI code review |
| **Sourcery** | `sourcery-ai[bot]` | AI code review |

### The Synchronization Gate

```bash
~/wopr-await-reviews.sh <PR_NUMBER> wopr-network/<repo>
```

This script:
1. Polls PR comments every 30 seconds
2. Checks for posts from each configured bot
3. Blocks until all 4 have posted (or 10-minute timeout)
4. Prints all 3 comment feeds when done (inline, reviews, top-level)
5. On timeout: prints `TIMEOUT: <missing bots>` — proceed anyway

### Layer 3: Agent Reviewer

The reviewer reads the `wopr-await-reviews.sh` output (all comments) plus the diff:

```bash
# Inline review comments (WHERE QODO /improve SUGGESTIONS APPEAR)
gh api repos/wopr-network/<repo>/pulls/<N>/comments \
  --jq '.[] | "[\(.user.login)] \(.path):\(.line // "?") — \(.body)"'

# Formal reviews
gh pr view <N> --repo wopr-network/<repo> --json reviews \
  --jq '.reviews[]? | "[\(.author.login) / \(.state)] \(.body)"'

# Top-level comments
gh api repos/wopr-network/<repo>/issues/<N>/comments \
  --jq '.[] | "[\(.user.login)] \(.body)"'

# The diff
gh pr diff <N> --repo wopr-network/<repo>
```

**Critical standing order**: ALWAYS call `gh api repos/<owner>/<repo>/pulls/<N>/comments` for inline comments. The `gh pr view` command does NOT include inline review comments — only formal reviews.

### Layer 4: Stuck Detection

Tracked in the pipeline lead's state:

```
STUCK = {
  "https://github.com/wopr-network/wopr/pull/42": {
    "missing null check in auth.ts:42": 3  // ← escalate at 3
  }
}
```

If any finding has been flagged 3+ times → remove from pipeline, report to human.

## Stale Qodo Comments

**Standing order**: If a Qodo comment has `line: null`, it's outdated (the code it referenced is no longer in the current diff). Reply to resolve it. Do NOT treat as blocking.

The reviewer prompt includes: "NEVER declare CLEAN if Qodo has any open /improve suggestions."

## Completion Signals

```
"CLEAN: https://github.com/wopr-network/wopr/pull/42"
```
or
```
"ISSUES: https://github.com/wopr-network/wopr/pull/42 — Missing null check in auth.ts:42 (Qodo); Unused import in handler.ts:3 (agent review)"
```

## Re-Review

After the fixer pushes changes, a new reviewer is spawned with the previous findings:

```
Task({
  subagent_type: "wopr-reviewer",
  name: "reviewer-81",
  model: "sonnet",
  prompt: "...This is a RE-REVIEW. Previous findings:
    - Missing null check in auth.ts:42
    Verify these are resolved. Check for new issues."
})
```
