# Stage 4: Fix

Targeted remediation — how review findings become code changes.

---

## Purpose

The fixer reads review findings and pushes targeted fixes to the existing PR. It does not redesign, refactor, or add features. It fixes exactly what was flagged and nothing more.

## The Constraint: Findings Only

The fixer works from a specific list of findings. Each finding has:

- A file and line reference
- A description of the problem
- A source (which reviewer or bot flagged it)

The fixer addresses each finding, one by one. It does not "improve" surrounding code. It does not "while I'm here" anything. Scope creep in the fix stage is how review loops become infinite.

## The Fix Process

```
1. Rebase on the main branch
   - Ensure the fix branch is current
   - If rebase conflicts exist, resolve them
   - If conflicts can't be resolved cleanly, escalate

2. For each finding:
   a. Read the finding
   b. Navigate to the file and line
   c. Understand the context
   d. Apply the minimal fix
   e. Verify the fix doesn't break anything (targeted tests)

3. Commit and push
   - All fixes in one commit (keeps the PR history clean)
   - The commit message references the findings

4. Report "Fixes pushed: <pr-url>"
```

## Rebase Before Fix

The fixer MUST rebase on the main branch before making any changes. Between the time the PR was created and the fix begins, other PRs may have merged. A fix applied to stale code can:

- Conflict with merged changes
- Fix a line that no longer exists
- Miss context from recently merged work

Rebase first. Always.

## Minimal Fixes

A fix is the smallest change that resolves the finding. Examples:

| Finding | Good Fix | Bad Fix |
|---------|----------|---------|
| Missing null check on line 42 | Add null check on line 42 | Refactor the entire function to use Option types |
| Unused import on line 3 | Remove the import | Reorganize all imports alphabetically |
| Missing error handling in catch block | Add proper error handling | Add error handling to every catch block in the file |
| SQL injection on line 87 | Parameterize the query | Rewrite the data access layer |

## Escalation

Some findings can't be fixed by the fixer:

- **Architectural issues** — "this should use the repository pattern" requires redesign, not a patch
- **Rebase conflicts** — the code has diverged too far from main
- **Missing context** — the finding references code the fixer doesn't understand
- **Contradictory findings** — two reviewers disagree about the right approach

When the fixer can't resolve a finding, it reports "Can't resolve" with a specific reason. The system removes the issue from the pipeline and flags it for human attention.

## Gate

The fix stage is complete when:

- All findings have been addressed (or escalated)
- The fix has been pushed to the PR branch
- The "Fixes pushed" message has been sent

The PR then re-enters the review stage. The reviewer verifies the fixes and checks for new issues introduced by the fix.

## Anti-Patterns

- **Fixer redesigns the solution** — fix what was flagged, nothing more. If the architecture is wrong, that's an escalation, not a fix.
- **Fixer ignores findings** — every finding must be addressed or explicitly escalated. Silent skipping defeats the review loop.
- **Fixer introduces new features** — a fix is corrective, not additive. New behavior belongs in a new issue.
- **Fixer skips rebase** — stale code produces merge conflicts. Rebase first.
- **Fixer fixes the test instead of the code** — if the test caught a real bug, fix the code. Only fix the test if the test itself is wrong.
