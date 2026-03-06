# Stage 3: Review

Multi-layered code review — how PRs are verified before merge.

---

## Purpose

The review stage verifies that a PR is correct, secure, tested, and architecturally sound. It combines automated review tools with an agent reviewer that triages all findings into a single verdict: CLEAN or ISSUES.

## The 4-Layer Review Defense

Review is not one check — it's four independent layers, each catching different classes of problems:

### Layer 1: CI Gates

Binary pass/fail. If CI fails, the review stops immediately — no point reviewing code that doesn't compile or pass tests.

The reviewer checks CI status FIRST. If any check is failing, it reports "ISSUES: CI failing" without reading the diff. The fixer addresses CI before code review happens.

### Layer 2: Automated Review Bots

External tools that analyze the PR diff and post findings as comments. These run asynchronously and may take minutes to complete.

**The synchronization problem:** If the reviewer reads the diff before all bots have posted, it will miss findings. The reviewer MUST wait for all configured bots to post before rendering a verdict.

**The synchronization gate:** A blocking script that polls until all configured review bots have posted comments on the PR, or a timeout expires. This is a [gate script](../../gates/gate-scripts.md) — a synchronization primitive that prevents the reviewer from racing ahead.

### Layer 3: Agent Reviewer

The agent reviewer reads:
1. The PR diff
2. ALL comments from all review bots (inline, formal reviews, and top-level)
3. The PR description and linked issue

It looks for problems the bots missed:
- Logic errors and edge cases
- Security issues (injection, path traversal, unsanitized input)
- Error handling gaps (swallowed errors, missing try/catch)
- Missing tests for new behavior
- Architectural violations (crossing module boundaries, bypassing abstraction layers)
- Leftover debug code, console logs

### Layer 4: Stuck Detection

A circuit breaker that prevents infinite review-fix loops. If the same finding is flagged 3+ times on the same PR, the system escalates to a human instead of spawning another fixer.

## The Review Process

```
1. Check CI
   - If FAILING → report ISSUES immediately, stop
   - If PENDING → wait briefly, then proceed
   - If PASSING → continue

2. Trigger review bots (if needed)
   - Some bots auto-trigger on PR creation
   - Others need explicit invocation (e.g., posting a command as a comment)

3. Wait for all bots to post
   - Use the synchronization gate
   - Proceed when all have posted or timeout expires

4. Read ALL comments
   - Inline review comments (line-level findings)
   - Formal reviews (APPROVE / REQUEST_CHANGES)
   - Top-level comments (summary posts, human comments)
   - Read EVERY comment from EVERY author — missing even one means missing findings

5. Review the diff yourself
   - Look for what the bots missed
   - Focus on logic, security, architecture, tests

6. Triage findings
   - Critical (must fix): security vulnerabilities, data loss, correctness bugs
   - Important (should fix): error handling gaps, pattern violations, bot suggestions
   - Skip: pure style nits, "consider" suggestions with no correctness impact

7. Render verdict
   - CLEAN: no critical or important findings
   - ISSUES: list all findings with file:line, description, source
```

## The Three Comment Feeds

Most code hosting platforms have three separate places where review comments appear. Missing any one means missing findings:

1. **Inline review comments** — attached to specific lines in the diff (this is where most bot suggestions appear)
2. **Formal reviews** — APPROVE or REQUEST_CHANGES with an optional body
3. **Top-level issue comments** — general comments on the PR (summaries, human notes)

The reviewer must check all three. A common mistake is reading only top-level comments and missing inline suggestions.

## Submitting the Review

The reviewer submits a formal review on the code hosting platform:

- **CLEAN** → approve the PR (or post an approval comment if the reviewer can't self-approve)
- **ISSUES** → request changes with a summary of all findings

This is mandatory — PRs typically can't enter a merge queue without an approval.

## Gate

The review stage is complete when:

- CI has been checked
- All configured review bots have posted (or timeout expired)
- All three comment feeds have been read
- A verdict has been rendered (CLEAN or ISSUES)
- A formal review has been submitted on the code hosting platform

## Anti-Patterns

- **Reviewing before CI passes** — waste of time. If CI fails, the code needs fixes before review is meaningful.
- **Declaring CLEAN before all bots post** — race condition. Bot findings are real — wait for them.
- **Reading only one comment feed** — inline comments are where the bugs are. Don't skip them.
- **Treating bot suggestions as optional** — if a configured bot posts a finding, it's blocking unless explicitly triaged as a style nit.
- **Infinite fix loops** — stuck detection exists for a reason. After 3 attempts at the same finding, escalate.
