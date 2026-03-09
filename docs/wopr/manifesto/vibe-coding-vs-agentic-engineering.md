# Vibe Coding vs Agentic Engineering — The WOPR Experience

> Implements: [method/manifesto/vibe-coding-vs-agentic-engineering.md](../../method/manifesto/vibe-coding-vs-agentic-engineering.md)
>
> See also: [The Thesis](the-thesis.md) — the full argument for why gates beat hope

---

## Before WOPR Had Gates

Early WOPR development used the vibe coding approach:
- Claude generated code
- A human glanced at the diff
- The code was pushed to main
- Bugs were discovered in production (or never)

The result: silent regressions, type errors that only surfaced at runtime, security issues that were discovered weeks later, and a codebase that nobody fully trusted.

## After Gates Were Added

The transformation was measurable:

| Before (Vibe) | After (Gated) |
|---------------|---------------|
| PRs merged in minutes | PRs take 10-30 minutes (CI + review bots + agent review) |
| ~40% of PRs introduced regressions | < 5% of PRs introduce regressions |
| Security issues found by humans weeks later | Security issues found by review bots in minutes |
| "Does this work?" required manual testing | CI + 4000+ automated tests answer definitively |
| No deployment record | Every deploy logged in wopr-ops |

## A Real Scenario: The Qodo Catch

Qodo (review bot) catches issues that the agent coder missed and the human would have missed too:

```
PR: Add session management to auth module
Agent coder: wrote the implementation, tests pass
Qodo /improve: "The session token is stored in localStorage.
  This is vulnerable to XSS. Use httpOnly cookies instead."
Agent reviewer: sees Qodo's finding, reports ISSUES
Fixer: implements httpOnly cookies
Re-review: CLEAN
```

Without Qodo, this security issue would have shipped to production. The gate caught it deterministically, every time, regardless of reviewer fatigue.

## The WOPR Cost

Concrete costs of the gated approach:

- **CI time**: ~3 minutes per PR (lint, type check, build, 4000+ tests)
- **Review bot time**: 2-8 minutes (Qodo, CodeRabbit, Devin, Sourcery post asynchronously)
- **Agent review time**: 1-3 minutes (reviewer reads diff + all bot comments)
- **Total overhead per PR**: 5-15 minutes more than "just merge it"

What that overhead buys:
- Type errors caught before they're committed
- Lint violations caught before they're reviewed
- Security issues caught by 4 independent bots
- Integration conflicts caught by the merge queue
- Zero "oops, I broke main" incidents

## Migration Path WOPR Followed

1. Added Biome (lint + format) as pre-commit hook
2. Added TypeScript strict mode
3. Added Vitest with growing test coverage
4. Added GitHub Actions CI pipeline
5. Added review bots (Qodo first, then CodeRabbit, Devin, Sourcery)
6. Added agent reviewer (Claude reading bot comments + diff)
7. Added merge queue (GitHub native)
8. Added operational memory (wopr-ops repo)

Each step was added when the previous step was stable. The full system took months to build, but each individual step provided immediate value.
