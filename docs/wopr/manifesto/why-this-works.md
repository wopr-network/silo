# Why This Works — WOPR's Evidence

> Implements: [method/manifesto/why-this-works.md](../../method/manifesto/why-this-works.md)

---

## The Numbers

Over the lifetime of the WOPR project:

- **4000+ automated tests** across the platform
- **4 review bots** (Qodo, CodeRabbit, Devin, Sourcery) on every PR
- **Merge queue** serializes all merges with integrated CI
- **12+ repos** in the wopr-network org, all following the same pipeline
- **Agent pipeline** processes 5-12 issues per session

## Real Catches

### Qodo /improve Catches

Qodo's `/improve` suggestions have caught:
- XSS vectors in user-generated content rendering
- Missing null checks on database query results
- Error handling gaps (empty catch blocks)
- Unused imports that bloated the bundle
- Type assertions that hid real type errors

### Merge Queue Catches

The merge queue has prevented:
- Two PRs that independently passed CI but conflicted when integrated
- A PR that passed CI on its branch but broke a test that another concurrent PR depended on
- Schema migration ordering issues where two PRs added migrations that needed to run in a specific order

### CLAUDE.md Gotchas Preventing Recurrence

Hard-won knowledge encoded in repo rule files:
- `wopr`: "Container names use `wopr-` prefix; node agent uses `tenant_` prefix — never conflate them"
- `wopr-platform`: "Never run `pnpm test` in worktrees — OOMs. Use `npx vitest run <specific-file>`"
- `wopr-plugin-types`: "ci required check has null app_id — use `--admin` to merge"
- All repos: "`@ts-ignore` is banned by biome `noTsIgnore` rule — use `declare module` ambient declarations"

Each of these represents a bug that was encountered, fixed, documented as a rule, and (where possible) promoted to an automated gate.

## The Compound Effect in Practice

Sprint 1 of WOPR: manually reviewing every PR, no review bots, no merge queue, frequent broken-main incidents.

Current state: The pipeline processes issues autonomously. An architect (Opus) specs the work. A coder (Sonnet) implements it. Four review bots scan it. A reviewer (Sonnet) triages findings. A fixer (Sonnet) addresses issues. The merge queue integrates it. All with minimal human intervention.

The human's role has shifted from "review every line of code" to "design the gates, set priorities, and handle escalations." The system does the rest.
