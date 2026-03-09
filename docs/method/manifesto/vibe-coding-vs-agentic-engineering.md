# Vibe Coding vs Agentic Engineering

> See first: [The Thesis](the-thesis.md) — why you must automate, and what happens when you do it without gates.

A side-by-side comparison of two approaches to AI-assisted software development.

---

## The Difference in One Sentence

**Vibe coding** trusts the AI's output. **Agentic engineering** trusts the gates.

---

## Side by Side

| Dimension | Vibe Coding | Agentic Engineering |
|-----------|------------|-------------------|
| **Trust model** | Trust the AI | Trust the gates |
| **Verification** | Human eyeballs the output | Deterministic gates verify every action |
| **Agents** | One general-purpose assistant | Specialized agents with defined contracts |
| **State** | Conversation context (ephemeral, invisible) | External systems (git, issue tracker, logbook) |
| **Error handling** | "Try again" / "Fix this" | Structured fix cycle with stuck detection |
| **Quality over time** | Constant — same failure modes every session | Improving — feedback loops prevent recurrence |
| **Scalability** | Bounded by human attention | Bounded by gate throughput |
| **Auditability** | Chat transcript (if saved) | Git commits, CI logs, issue tracker history |
| **Reproducibility** | Low — same prompt can produce different results | High — same code always passes or fails the same gates |
| **Deployment** | Manual or ad-hoc | Gated pipeline with post-deploy verification |

---

## How Each Handles Common Scenarios

### Scenario: AI introduces a bug

**Vibe coding:** The human notices the bug (maybe), asks the AI to fix it, hopes the fix is correct.

**Agentic engineering:** The type checker, linter, or test suite catches the bug before it reaches a branch. If it slips through to review, the review bots or agent reviewer catches it. If it slips through to production, post-deploy smoke tests catch it and auto-rollback fires. The finding feeds back into the gate system to prevent recurrence.

### Scenario: AI generates insecure code

**Vibe coding:** Nobody notices until a security audit (if one ever happens) or a breach.

**Agentic engineering:** The secret scanning gate catches hardcoded credentials. The input validation gate catches unsanitized user input. The security audit agent flags injection vectors. If a security finding makes it through, the fix cycle resolves it and the finding graduates to a permanent lint rule.

### Scenario: A deploy breaks production

**Vibe coding:** Someone notices the site is down, scrambles to figure out what changed, manually rolls back.

**Agentic engineering:** Post-deploy verification runs automatically. Smoke tests detect the broken user journey within minutes. The system auto-rolls back to the previous known-good image SHA. An incident is logged with root cause. A Linear issue is auto-created. The next pipeline cycle picks up the fix.

### Scenario: The same bug keeps recurring

**Vibe coding:** Developers fix it again each time, grumbling about AI-generated code quality.

**Agentic engineering:** After the first occurrence, the finding becomes a project-level rule. After the second, it becomes a lint check. After the third, it becomes a build-blocking gate. By the fourth occurrence, the bug is impossible to commit.

---

## The Compound Effect

Vibe coding has linear cost. Every session starts from zero. The AI doesn't remember what went wrong last time. The human might, but they can't encode their knowledge into the system.

Agentic engineering has compounding returns. Every finding that feeds back into the gate system makes the next sprint easier:

```
Sprint 1:   100 findings in review, 30 in CI, 5 in production
Sprint 5:    60 findings in review, 15 in CI, 1 in production
Sprint 10:   30 findings in review,  5 in CI, 0 in production
Sprint 50:   10 findings in review,  1 in CI, 0 in production
```

The system gets cheaper to run over time because the gates get smarter. This only happens if the feedback loops are real — automated, not aspirational.

---

## When Vibe Coding is Fine

Vibe coding works for:
- Throwaway scripts you'll run once
- Prototypes that won't see production
- Learning exercises where correctness doesn't matter
- Quick explorations where you'll rewrite everything anyway

Vibe coding does NOT work for:
- Production software serving real users
- Systems handling money, health data, or credentials
- Multi-repo codebases with cross-cutting concerns
- Any project where "it works on my machine" isn't good enough

---

## The Migration Path

Moving from vibe coding to agentic engineering is incremental, not all-or-nothing:

1. **Add one gate** — start with a linter or type checker. Run it before every commit.
2. **Add CI** — the same gate, but enforced on every PR. No merging without green CI.
3. **Add review bots** — automated code review that catches what the linter misses.
4. **Add agent specialization** — separate architect, coder, and reviewer roles instead of one general assistant.
5. **Add the feedback loop** — findings from review graduate into permanent rules.
6. **Add post-deploy verification** — smoke tests that verify the running system, not just the code.
7. **Add the event bus** — phase transitions trigger automatically instead of requiring human intervention.

Each step is independently valuable. You don't need all seven to be better than vibe coding. You need one.
