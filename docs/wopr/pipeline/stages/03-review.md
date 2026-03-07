# Stage 3: Review — The WOPR Implementation

> Implements: [method/pipeline/stages/03-review.md](../../../method/pipeline/stages/03-review.md)

---

## Gates Before Review

Before the entity reaches the `reviewing` state, two gates must pass:

**`ci-green`**: CI checks on the PR must all pass. DEFCON runs `gates/ci-green.sh` which polls `gh pr checks`. If CI fails, the gate returns false, and the entity returns to `coding` with the `failure_prompt` surfacing the CI failure output.

**`review-bots-ready`**: Automated review bots (Qodo, CodeRabbit, Devin, Sourcery) must all post. DEFCON runs `gates/review-bots-ready.sh`. If bots don't post within 10 minutes, the gate times out and the `timeout_prompt` instructs the reviewer to proceed with manual review.

---

## The 4-Layer Review in WOPR

### Layer 1: CI Gates (GitHub Actions)

Already verified by the `ci-green` gate before this state is reached. The reviewer double-checks:

```bash
gh pr checks <PR_NUMBER> --repo wopr-network/<repo>
```

If ANY check is FAILING → report `issues` immediately, no code review.

### Layer 2: Review Bots

WOPR uses 4 automated review bots:

| Bot | Username | What it does |
|-----|----------|-------------|
| **Qodo** | `qodo-code-review[bot]` | Posts `/improve` suggestions as inline comments. These are blocking. |
| **CodeRabbit** | `coderabbitai[bot]` | AI code review with inline suggestions |
| **Devin** | `devin-ai[bot]` | AI code review |
| **Sourcery** | `sourcery-ai[bot]` | AI code review |

The `review-bots-ready` gate blocks until all 4 have posted (or times out with a `timeout_prompt`).

### Layer 3: Agent Reviewer

The reviewer reads all comments plus the diff. The `reviewing` state promptTemplate includes these exact commands:

```bash
# Inline review comments (WHERE QODO /improve SUGGESTIONS APPEAR)
gh api repos/{{entity.refs.github.repo}}/pulls/{{entity.artifacts.prNumber}}/comments \
  --jq '.[] | "[\(.user.login)] \(.path):\(.line // "?") — \(.body)"'

# Formal reviews
gh pr view {{entity.artifacts.prNumber}} --repo {{entity.refs.github.repo}} --json reviews \
  --jq '.reviews[]? | "[\(.author.login) / \(.state)] \(.body)"'

# Top-level comments
gh api repos/{{entity.refs.github.repo}}/issues/{{entity.artifacts.prNumber}}/comments \
  --jq '.[] | "[\(.user.login)] \(.body)"'

# The diff
gh pr diff {{entity.artifacts.prNumber}} --repo {{entity.refs.github.repo}}
```

**Critical standing order**: ALWAYS call `gh api repos/<owner>/<repo>/pulls/<N>/comments` for inline comments. The `gh pr view` command does NOT include inline review comments — only formal reviews.

### Layer 4: Gate-Based Stuck Detection

DEFCON tracks gate failures per entity. If the same gate fails 3+ times, the entity is transitioned to the `stuck` state. The reviewer does not need to track this manually.

---

## Stale Qodo Comments

**Standing order**: If a Qodo comment has `line: null`, it's outdated (the code it referenced is no longer in the current diff). Reply to resolve it. Do NOT treat as blocking.

The `reviewing` promptTemplate includes: "If a Qodo comment has `line: null`, it is outdated — reply to resolve it, do NOT treat as blocking."

---

## Completion Signals

The reviewer calls `flow.report` with either `clean` or `issues`:

**CLEAN:**
```json
{
  "workerId": "wkr_abc123",
  "entityId": "feat-392",
  "signal": "clean"
}
```

**ISSUES:**
```json
{
  "workerId": "wkr_abc123",
  "entityId": "feat-392",
  "signal": "issues",
  "artifacts": {
    "reviewFindings": "Missing null check in auth.ts:42 (Qodo); Unused import in handler.ts:3 (agent review)"
  }
}
```

`clean` → entity advances to `merging`.
`issues` → entity returns to `fixing` with `reviewFindings` injected into the fixer's prompt.
