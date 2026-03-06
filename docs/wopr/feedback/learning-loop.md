# Learning Loop — The WOPR Implementation

> Implements: [method/feedback/learning-loop.md](../../method/feedback/learning-loop.md)

---

## WOPR's Feedback Loop in Action

### The CLAUDE.md Gotchas Pattern

After every fix cycle (fixer ran at least once AND reviewer declares CLEAN), the pipeline spawns a one-shot CLAUDE.md updater:

```
Task({
  subagent_type: "general-purpose",
  name: "claude-md-updater-81",
  model: "haiku",
  team_name: "wopr-auto",
  run_in_background: true,
  prompt: "You are a one-shot CLAUDE.md updater.

    Repo: wopr-network/wopr
    Codebase: /home/tsavo/wopr
    Fixer findings resolved in this PR:
      - Missing null check in session.ts:42
      - @ts-ignore used instead of declare module

    1. Read /home/tsavo/wopr/CLAUDE.md
    2. If >= 950 lines: consolidate related entries
    3. For each finding: does it represent a generalizable invariant?
    4. For YES findings: add one line under ## Gotchas
    5. If changed: git add CLAUDE.md && git commit
    6. If nothing worth adding: exit silently"
})
```

### Hard limits on the updater:
- CLAUDE.md must stay under 1000 lines
- Add at most 3 new lines per PR
- Do not rewrite existing content, only append or consolidate
- Do not commit anything except CLAUDE.md

## Real Examples of the Loop

### Example 1: @ts-ignore → Gate

```
Sprint 1: Agent uses @ts-ignore in wopr-plugin-discord
  → Caught in review. Fixed manually.

Sprint 2: Agent uses @ts-ignore in wopr-platform
  → Caught in review. Added to CLAUDE.md:
    "- **biome**: @ts-ignore is banned; use declare module"

Sprint 3: Agent uses @ts-ignore in wopr
  → Despite CLAUDE.md rule, agent didn't follow it
  → Promoted to biome gate: noTsIgnore: "error" in biome.json
  → Now a CI failure. Can never reach review again.
```

### Example 2: pnpm test OOM → Standing Order

```
Session 1: Agent runs pnpm test in worktree → OOM killed
  → Fixed by running npx vitest run <file> instead

Session 2: Different agent runs pnpm test in worktree → OOM again
  → Added to CLAUDE.md gotchas
  → Added to MEMORY.md standing orders
  → Now every agent reads this before starting
```

### Example 3: Missing Inline Comments → Process Fix

```
Session 1: Reviewer used gh pr view --json reviews → missed Qodo inline comments
  → Qodo suggestions not addressed. PR merged with issues.

Session 2: Same problem. Discovered gh api repos/.../pulls/<N>/comments is needed
  → Added to MEMORY.md: "ALWAYS call gh api for inline comments"
  → Updated reviewer prompt template
  → Now every reviewer agent includes this step
```

### Example 4: Merge Queue GraphQL → Standing Order

```
Session 1: Pipeline used gh pr merge for wopr repo → failed (merge queue enabled)
  → Discovered GraphQL enqueuePullRequest mutation

Session 2: Same error on wopr-platform → same fix needed
  → Added to MEMORY.md: "wopr merge queue: use GraphQL enqueuePullRequest"
  → Standing order prevents recurrence
```

## The Three Stages in WOPR

| Stage | Where it lives | Example |
|-------|---------------|---------|
| Stage 1: Unknown | Caught in review, fixed once | First @ts-ignore catch |
| Stage 2: Known | CLAUDE.md gotchas + MEMORY.md | "@ts-ignore is banned" rule |
| Stage 3: Prevented | biome.json, CI gates | `noTsIgnore: "error"` in biome |

## Cross-Repo Propagation

When a gotcha is learned in one repo, the grooming process checks if it applies elsewhere:

```
Codebase advocate scans all repos:
  → Found @ts-ignore in wopr-plugin-telegram (caught by biome)
  → Checked: does wopr-plugin-whatsapp have noTsIgnore?
  → No → filed issue to add it
```

The `/wopr:groom` security advocate also propagates security findings:
```
Security advocate:
  → Found exec() with user input in wopr-plugin-discord
  → Checked all other plugin repos for same pattern
  → Filed issues for each repo with the vulnerability
```

## What Gets Promoted in WOPR

| Finding | Rule? | Gate? |
|---------|-------|-------|
| @ts-ignore usage | Yes (CLAUDE.md) | Yes (biome `noTsIgnore`) |
| pnpm test OOM in worktrees | Yes (MEMORY.md) | No (can't gate — it's a runtime issue) |
| Missing inline comment API call | Yes (MEMORY.md) | No (process rule, not codeable) |
| Unused imports | No (biome catches automatically) | Yes (biome lint) |
| console.log instead of ctx.log | Yes (CLAUDE.md) | Planned (custom biome rule) |
| Secrets in source code | Yes (org rule) | Yes (GitHub secret scanning) |
