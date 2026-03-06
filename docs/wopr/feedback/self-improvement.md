# Self-Improvement — The WOPR Implementation

> Implements: [method/feedback/self-improvement.md](../../method/feedback/self-improvement.md)

---

## WOPR's Five Levels in Practice

### Level 1: Gate Evolution

**Real examples**:

| Gate Added | Trigger | Implementation |
|-----------|---------|---------------|
| `noTsIgnore` in biome | Agents kept using @ts-ignore (3x) | `biome.json`: `"noTsIgnore": "error"` |
| TypeScript strict mode | Type errors at runtime caught in review | `tsconfig.json`: `"strict": true` |
| GitHub secret scanning | Agent committed a test API key | Enabled on all wopr-network repos |
| Merge queue (wopr) | Two concurrent PRs broke main when merged | GitHub merge queue ruleset |

### Level 2: Prompt Evolution

**Real examples**:

| Prompt Change | Trigger | Implementation |
|--------------|---------|---------------|
| "Wait for all bots before reviewing" | Reviewer declared CLEAN before Qodo posted | Updated reviewer prompt template |
| "Check CI FIRST" | Reviewer spent time reading diff on a failing-CI PR | Added Step 1 to reviewer prompt |
| "ALWAYS call gh api for inline comments" | Missed Qodo /improve suggestions | Added to reviewer prompt + MEMORY.md |
| "Rebase before fixing" | Fixer applied fix to stale code, caused conflicts | Added Step 1 to fixer prompt |
| "Never CLEAN with open Qodo suggestions" | Qodo findings treated as optional | Added explicit rule to reviewer prompt |

### Level 3: Config Self-Tuning

**Real examples**:

| Parameter | Old | New | Signal |
|-----------|-----|-----|--------|
| Review bot timeout | 5 min | 10 min | Qodo consistently took 7-8 min |
| Max concurrent agents | 6 | 4 | Too many merge conflicts with 6 |
| PR backlog gate | none | 4 per repo | Queue backed up with 8 open PRs |
| Stuck threshold | 5 | 3 | Agents spinning on the same finding |

### Level 4: Cross-Repo Propagation

**Real examples**:

| Rule | Origin Repo | Propagated To |
|------|------------|---------------|
| `noTsIgnore` biome rule | wopr-plugin-discord | All wopr-plugin-* repos |
| `console.log → ctx.log` | wopr-plugin-discord | All wopr-plugin-* repos |
| Container naming convention | wopr | CLAUDE.md in all repos |
| `--admin` merge for null app_id checks | wopr-plugin-types | wopr-plugin-msteams |
| `npx vitest run <file>` not `pnpm test` | wopr-platform | MEMORY.md (all sessions) |

### Level 5: SOP Self-Evolution

**Real examples**:

| Change | What triggered it | Impact |
|--------|------------------|--------|
| Added QA team design | No post-deploy verification existed | method/qa/ section added |
| Added trigger taxonomy | "How do agents get triggered?" was undocumented | method/pipeline/triggers/ added |
| Added logbook protocol | Operations knowledge was lost between sessions | method/devops/logbook-protocol.md |
| Added stuck detection | Infinite review-fix loops on the same finding | Circuit breaker added to pipeline |
| Added backpressure gate | Merge queue saturated with too many PRs | Standing order + PR count check |
| Created this repo | SOP existed only in skill definitions | agentic-engineering repo |

This last example — creating the agentic-engineering repo — is itself a Level 5 improvement. The methodology was implicit in the skill definitions. Making it explicit and public is the system improving its own documentation.

## The Meta Loop

```
Level 5 produces: this repository (agentic-engineering)
  ↓
This repository documents: Levels 1-5
  ↓
Future improvements to the methodology: documented here
  ↓
The system improves its own improvement process
```

## What's Next

Planned improvements based on current gaps:

| Level | Improvement | Status |
|-------|------------|--------|
| 1 | Custom biome rule for `console.log → ctx.log` | Planned |
| 1 | Import boundary gate (eslint-plugin-boundaries) | Planned |
| 2 | Auto-generate reviewer prompts from repo CLAUDE.md | Planned |
| 3 | Token cost tracking per agent for model routing optimization | Planned |
| 4 | Automated cross-repo rule propagation (not just during groom) | Planned |
| 5 | Fully automated trigger chain (no human `/wopr:auto` needed) | Planned |
