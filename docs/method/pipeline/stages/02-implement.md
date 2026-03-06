# Stage 2: Implement

Code generation — how specs become working code.

---

## Purpose

The coder reads the architect's spec and implements it. The output is a PR on a feature branch with passing tests.

## The Spec-First Constraint

The coder implements FROM the spec, not from the issue description. The architect has already done the analysis — the coder's job is execution, not redesign.

**Why spec-first?**

- The architect used a high-reasoning model to analyze the codebase and design the solution. The coder uses a fast-execution model to implement it. Re-analyzing the codebase would waste the architect's work.
- The spec is specific and actionable. The issue description is high-level and ambiguous. Implementing from the issue leads to misalignment.
- When the spec is followed, the review phase can verify "did the coder build what the architect designed?" — a concrete question with a concrete answer.

## Test-Driven Development

Implementation follows TDD:

```
1. Write the test first
   - The test asserts the behavior the spec requires
   - Run it — it must FAIL (because the code doesn't exist yet)
   - If it passes before any code change, the test isn't covering the right thing

2. Write the minimal code to make the test pass
   - Follow the spec step by step
   - Don't add features the spec doesn't mention
   - Don't refactor code the spec doesn't touch

3. Verify the test passes
   - Run targeted tests only (not the full suite — it's slow)
   - If it fails, fix the code (not the test)
```

**Why TDD?**

- Tests written after implementation tend to test what the code does (tautological). Tests written before implementation test what the code should do (behavioral).
- A failing test before the fix proves the test is meaningful. A test that passes before any change is worthless.
- TDD prevents scope creep. The coder writes exactly enough code to pass the test, nothing more.

## Isolation

The coder works in an isolated environment:

- **Feature branch** — never commits to main directly
- **Worktree** — isolated working directory, separate from the main clone
- **No cross-contamination** — changes in one issue's worktree don't affect another

**Why isolation?**

- Multiple coders can work on different issues simultaneously without conflicts
- If an implementation goes wrong, the worktree can be discarded without affecting other work
- The main clone stays clean for architect agents to read from

## Verification Before Commit

Before committing, the coder verifies:

1. **Build passes** — the code compiles/transpiles without errors
2. **Targeted tests pass** — tests related to the changed files
3. **The implementation matches the spec** — every step in the spec has been addressed
4. **No unintended changes** — git diff shows only what was planned

## The PR

The coder creates a PR with:

- **Title** — conventional commit format with issue key
- **Description** — summary of changes, link to issue, test plan
- **Targeted scope** — only the files the spec identified, nothing more

## Gate

The implementation stage is complete when:

- A PR has been created on a feature branch
- CI is running (or has passed)
- The "PR created" message has been sent with the PR URL

## Anti-Patterns

- **Coder redesigns the solution** — the architect designed it. The coder implements it. If the spec is wrong, report it — don't silently diverge.
- **Coder runs the full test suite** — full suites are slow and can exhaust resources. Run only the targeted test files.
- **Coder refactors surrounding code** — fix what the spec says. Don't "improve" adjacent code.
- **Coder adds features** — implement the spec, nothing more. New ideas go in new issues.
- **Coder works in the main clone** — always use an isolated worktree.
