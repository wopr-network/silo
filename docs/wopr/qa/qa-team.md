# QA Team — The WOPR Implementation

> Implements: [method/qa/qa-team.md](../../method/qa/qa-team.md)

---

## Current State

WOPR's QA team is partially implemented. The `/wopr:audit` skill provides repo-level auditing. Post-deploy verification is designed but not yet fully automated.

## The /wopr:audit Skill

The audit skill spawns 5 parallel specialist agents:

```
TeamCreate({ team_name: "wopr-audit", description: "Audit <repo>" })
```

| Agent | Name | Model | What it checks |
|-------|------|-------|----------------|
| Correctness | `correctness-auditor` | Opus | Type errors, race conditions, null safety, error handling |
| Completeness | `completeness-auditor` | Opus | TODOs, stub implementations, missing manifest fields, lifecycle gaps |
| Practices | `practices-auditor` | Opus | Plugin contract, import boundaries, logger usage, config schema |
| Testing | `test-auditor` | Opus | Coverage gaps, weak assertions, missing cleanup, async test correctness |
| Security | `security-auditor` | Opus | Injection vectors, secret exposure, auth bypass, XSS, CSRF |

All 5 spawn in parallel with `run_in_background: true`.

### Audit Output

Each agent sends findings to the team lead:
```
SendMessage({
  type: "message",
  recipient: "team-lead",
  content: "[CORRECTNESS] Missing null check\n- File: src/auth.ts:42\n- Severity: high\n...",
  summary: "Correctness: 5 findings"
})
```

The team lead compiles a consolidated report:

```
# Audit Report: wopr-plugin-discord

## Summary
| Category     | Critical | High | Medium | Low | Total |
|-------------|----------|------|--------|-----|-------|
| Correctness  | 0        | 2    | 3      | 1   | 6     |
| Completeness | 0        | 1    | 2      | 0   | 3     |
| Practices    | 0        | 0    | 4      | 2   | 6     |
| Testing      | 1        | 3    | 2      | 0   | 6     |
| Security     | 0        | 1    | 1      | 0   | 2     |
| **TOTAL**    | **1**    | **7**| **12** | **3**| **23**|
```

### Filing Issues

After the audit, the user chooses:
- "File all critical + high as Linear issues"
- "File all findings as Linear issues"
- "Discuss first"
- "Done"

If filing, findings are mapped to Linear issues using the `wopr-create-stories` skill.

## Post-Deploy QA (Planned)

The target QA team for post-deploy verification:

### Smoke Tester Agent

```
Task({
  subagent_type: "general-purpose",
  name: "smoke-tester",
  model: "sonnet",
  prompt: "Run e2e smoke tests against production:
    cd /home/tsavo/wopr-platform
    npx vitest run tests/e2e/smoke/
    Report results."
})
```

### Integration Tester Agent

```
Task({
  subagent_type: "general-purpose",
  name: "integration-tester",
  model: "sonnet",
  prompt: "Verify integrations:
    - Database: psql $DATABASE_URL -c 'SELECT 1'
    - Stripe: curl https://api.stripe.com/v1/balance -H 'Authorization: Bearer sk_test_...'
    - Auth: curl http://localhost:3000/api/auth/session
    Report results."
})
```

### Regression Watcher Agent

```
Task({
  subagent_type: "general-purpose",
  name: "regression-watcher",
  model: "haiku",
  prompt: "Compare current metrics against baseline:
    - Check Caddy access logs for latency changes
    - Check docker stats for resource usage
    - Report any regression > 20%"
})
```

### QA Lead

The QA lead (main session or spawned agent) triages findings:
- All smoke tests pass + all integrations healthy → **proceed**
- Any smoke test fails → **rollback immediately**
- Metric regression > 20% → **investigate**
