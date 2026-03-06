# Gate Scripts — The WOPR Implementation

> Implements: [method/gates/gate-scripts.md](../../method/gates/gate-scripts.md)

---

## WOPR's Synchronization Scripts

### wopr-await-reviews.sh

**Location**: `~/wopr-await-reviews.sh`

**Purpose**: Blocks until all 4 review bots (Qodo, CodeRabbit, Devin, Sourcery) have posted comments on a PR.

**Usage**:
```bash
~/wopr-await-reviews.sh <PR_NUMBER> wopr-network/<REPO>
```

**Behavior**:
1. Polls PR comments every 30 seconds
2. Checks for posts from: `qodo-code-review[bot]`, `coderabbitai[bot]`, `devin-ai[bot]`, `sourcery-ai[bot]`
3. When all 4 have posted → prints all 3 comment feeds → exit 0
4. After 10 minutes → prints `TIMEOUT: <missing bots>` → prints available comments → exit 0

**Output structure**:
```
=== INLINE REVIEW COMMENTS ===
[qodo-code-review[bot]] src/auth/session.ts:42 — Consider adding null check...
[coderabbitai[bot]] src/handler.ts:17 — Unused import...

=== FORMAL REVIEWS ===
[coderabbitai[bot] / COMMENTED] Summary of findings...

=== TOP-LEVEL COMMENTS ===
[qodo-code-review[bot]] PR Analysis: ...
[sourcery-ai[bot]] Summary: ...
```

The reviewer agent reads this output to get all bot findings before reviewing the diff.

### wopr-pr-watch.sh

**Location**: `~/wopr-pr-watch.sh`

**Purpose**: Blocks until a PR resolves in the merge queue (merged, ejected, or closed).

**Usage**:
```bash
~/wopr-pr-watch.sh <PR_NUMBER> wopr-network/<REPO>
```

**Behavior**:
1. Polls `gh pr view` every 30 seconds
2. Checks PR state and merge status
3. Exits with single-line result:

| Condition | Output | Exit Code |
|-----------|--------|-----------|
| PR merged | `MERGED: PR #42 merged` | 0 |
| CI failing in queue | `BLOCKED: CI failing — <check names>` | 1 |
| PR closed without merge | `CLOSED: PR #42 closed` | 1 |
| 15 minutes elapsed | `TIMEOUT: PR #42 still in queue` | 1 |

**Used by**: Watcher agents (`watcher-<N>`) spawned after a PR enters the merge queue.

## How the Reviewer Uses Gate Scripts

The reviewer's workflow:

```
Step 1: Check CI
  gh pr checks <N> --repo wopr-network/<repo>
  → If failing: report ISSUES immediately

Step 2: Wait for bots (BLOCKING)
  ~/wopr-await-reviews.sh <N> wopr-network/<repo>
  → Blocks up to 10 minutes
  → Prints all comments when done

Step 3: Read the output (all comments from all bots)

Step 4: Review the diff
  gh pr diff <N> --repo wopr-network/<repo>

Step 5: Render verdict (CLEAN or ISSUES)
```

## How the Watcher Uses Gate Scripts

```
Step 1: Run the watch script (BLOCKING)
  ~/wopr-pr-watch.sh <N> wopr-network/<repo>
  → Blocks up to 15 minutes

Step 2: Report result to pipeline lead
  "Merged: <url> for WOP-81"
  or "BLOCKED: <url> for WOP-81 — CI failing: <checks>"
  or "CLOSED: <url> for WOP-81"
```

## Script Design

Both scripts follow the gate script pattern:

- **Deterministic**: same PR state → same output
- **Blocking**: caller waits for exit
- **Timeout-bounded**: never runs forever (10 min / 15 min)
- **Structured output**: machine-parseable on stdout
- **Progress on stderr**: "Waiting for bots... (2/4 posted)"
- **Idempotent**: safe to run multiple times
- **No side effects**: scripts only read state, never modify it
