# Migration Guide

Moving from vibe coding (or ad-hoc AI workflows) to agentic engineering — step by step.

---

## Where You Might Be Starting

### Scenario A: No AI, Just Manual Development

You have a codebase, a team, and manual workflows. AI hasn't entered your process yet.

**Your path**: Start with [Tier 1 of the checklist](./checklist.md). Add gates (linter, tests, CI) before introducing AI agents. When agents arrive, they'll operate within guard rails from day one.

### Scenario B: Vibe Coding (AI Without Gates)

You're using AI (Copilot, Claude, ChatGPT) to write code, but there are no gates. AI output goes straight to main or gets a cursory human review.

**Your path**: This is the most common starting point. Follow the migration steps below.

### Scenario C: Partial Gates

You have CI and tests, but AI agents bypass them (e.g., AI commits directly, skips review, or uses `--no-verify`).

**Your path**: Enforce the gates on AI output. The gates exist — make sure agents can't skip them.

### Scenario D: Structured AI Workflow

You have a pipeline with some structure (specs, reviews) but it's not formalized and doesn't have all the components.

**Your path**: Use the [checklist](./checklist.md) to identify what's missing. You're probably at Tier 2 and need to move to Tier 3-4.

---

## Migration Steps (Scenario B: Vibe Coding → Agentic)

### Step 1: Audit Your Current State

Before changing anything, understand what you have:

```
Questions to answer:
- Which repos have CI? Which don't?
- Which repos have tests? What's the coverage?
- Do you have a linter? Is it enforced?
- How do PRs get merged? Branch protection? Direct push?
- Who reviews code? Is review required?
- What AI tools are you using? How are they configured?
- Where do you track work? Issues? Notion? Slack?
```

### Step 2: Add Gates to Existing Repos

For each repo that's missing gates:

**Day 1-2: Linter**
```bash
# JavaScript/TypeScript
npx @biomejs/biome init

# Python
pip install ruff
ruff check .

# Go
golangci-lint run
```

Add to CI and make it blocking.

**Day 3-4: Type Checking**
```bash
# TypeScript
npx tsc --noEmit

# Python
pip install mypy
mypy .
```

Add to CI and make it blocking.

**Day 5-7: Tests**
```bash
# If no tests exist: write 5-10 tests for the most critical paths
# Don't boil the ocean — start with auth, core API, and data layer
```

Add test runner to CI. Make it blocking.

### Step 3: Enforce Gates on AI Output

This is the critical step. AI output must go through the same gates as human output:

1. **Branch protection**: Require CI to pass before merge. No exceptions.
2. **No `--no-verify`**: Agents must not skip pre-commit hooks.
3. **No direct push to main**: All changes go through PRs.
4. **Review required**: At least one review (human or automated) before merge.

### Step 4: Add a Rule File

Create a rule file at your repo root:

```markdown
# CLAUDE.md (or .cursorrules, etc.)

## Build Commands
- `npm run lint` — run linter
- `npm run test` — run tests
- `npm run build` — build the project

## Conventions
- Use `camelCase` for variables, `PascalCase` for types
- Put new features in `src/features/<name>/`
- Use the logger, not `console.log`

## Gotchas
- Never import from `src/internal/` — it's not a public API
- Tests must clean up after themselves (no test data left in DB)
```

### Step 5: Separate Spec from Code

Instead of "AI, build the feature":

```
Before (vibe):
  "Add user authentication to the app"
  → AI writes code → merge

After (structured):
  1. Write (or have the AI write) a spec:
     - What endpoints? What schemas? What flows?
  2. AI implements FROM the spec
  3. Review verifies: did the AI build what the spec described?
```

Even a 10-line spec is better than no spec. The spec forces thinking before coding.

### Step 6: Add Review

If you don't have review:

**Minimum**: Add one review bot (Qodo, CodeRabbit, or Sourcery). Free tiers exist. Configure it to run on every PR. Read its findings before merging.

**Better**: Have an AI agent review the PR (separate from the one that wrote it). The key insight: a different agent has a different perspective and catches different things.

### Step 7: Close the Loop

When you find a bug that the gates didn't catch:

1. Ask: "Could a gate have caught this?"
2. If yes: add the gate (lint rule, test, CI check)
3. If no: add it to the rule file as a gotcha

This is the feedback loop. It starts with you and a simple question: "How do I prevent this from happening again?"

---

## What NOT to Migrate

Some vibe coding practices are fine and shouldn't be over-processed:

- **Prototyping**: When you're exploring ideas, don't gate everything. Prototype freely, then apply the methodology when you know what you're building.
- **One-off scripts**: A script that runs once doesn't need a pipeline.
- **Learning projects**: If you're learning a new technology, gates slow down the learning. Add them when the project becomes real.

## Timeline Expectations

| Milestone | Typical Timeline | What You Have |
|-----------|-----------------|---------------|
| Gates operational | 1-2 weeks | Linter, tests, CI, branch protection |
| Structured pipeline | 2-4 weeks | Spec → code → review → merge |
| Review automation | 1-2 months | Review bots, agent reviewer |
| Full pipeline | 3-6 months | Grooming, architect, merge queue, devops, QA |

Don't rush. Each step provides value. A team with solid Tier 1 gates is already ahead of most AI-assisted development workflows.

## Measuring Success

How to know the migration is working:

| Metric | Before (Vibe) | After (Gated) |
|--------|--------------|---------------|
| Bugs that reach production | Frequent, unpredictable | Rare, each one triggers a new gate |
| Time to fix broken main | Hours (debugging) | Minutes (auto-caught by CI) |
| Agent output quality | Variable | Consistent (rules enforce conventions) |
| Review cycle time | Depends on human availability | Minutes (automated bots + agent) |
| Confidence in deploys | "Hope it works" | "Gates verified it" |
