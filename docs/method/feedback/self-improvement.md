# Self-Improvement

Five levels of system evolution — from reactive fixes to autonomous adaptation.

---

## The Hierarchy

Self-improvement isn't one thing — it's a ladder. Each level builds on the one below it. Skip a level and the system can't sustain the improvements above it.

```
Level 5: SOP Self-Evolution
         The methodology itself changes based on outcomes
         ↑
Level 4: Cross-Repo Propagation
         Lessons learned in one repo spread to all repos
         ↑
Level 3: Config Self-Tuning
         Thresholds, timeouts, and parameters adjust based on data
         ↑
Level 2: Prompt Evolution
         Agent instructions improve based on failure patterns
         ↑
Level 1: Gate Evolution
         New gates added, existing gates refined
```

## Level 1: Gate Evolution

**What changes**: The gates themselves — what they check, how they check it, and what thresholds they use.

**Trigger**: A class of problem reaches a stage it shouldn't have (e.g., a security issue reaches review that should have been caught by a lint rule).

**Mechanism**:
```
1. Reviewer catches a problem
2. Problem is flagged: "Should this have been a gate?"
3. If pattern (occurred 2+ times): create the gate
4. Add to CI pipeline
5. Problem can no longer reach review
```

**Example**:
- Reviewer catches: `eval()` used with user input
- First occurrence: fix it
- Second occurrence: add rule "never use eval() with external input"
- Third occurrence: add ESLint rule `no-eval` to CI

## Level 2: Prompt Evolution

**What changes**: The agent definition files — the instructions agents follow.

**Trigger**: An agent makes a mistake that isn't a code error but a process error (wrong workflow, missed step, incorrect assumption).

**Mechanism**:
```
1. Agent produces a bad outcome despite following its instructions
2. Post-mortem: why did the instructions lead to this?
3. Update the agent definition file
4. Next invocation uses improved instructions
```

**Example**:
- Reviewer declares CLEAN before all review bots have posted
- Root cause: the definition file didn't mention waiting for bots
- Fix: add "Wait for all configured bots before rendering verdict"
- Next reviewer invocation includes this instruction

### The Rule File Update Pattern

After a fix cycle resolves findings, check: "Does this finding represent a generalizable invariant?"

- **YES**: Add a line to the repo's rule file. Example: "Container names use `wopr-` prefix."
- **NO**: It was a one-off mistake, too PR-specific, or already captured. Skip.

This keeps the rule file growing with genuine operational knowledge, not noise.

## Level 3: Config Self-Tuning

**What changes**: Numerical parameters — timeouts, thresholds, intervals, limits.

**Trigger**: A parameter is consistently too strict (causing false positives) or too loose (missing real problems).

**Mechanism**:
```
1. Collect data on gate outcomes over time
2. Identify parameters that are miscalibrated:
   - Timeout too short → gate times out on healthy PRs
   - Threshold too low → alerts fire on normal variation
   - Concurrency too high → merge queue backs up
3. Adjust the parameter
4. Monitor the adjustment
```

**Example**:
- Review bot synchronization timeout: 5 minutes
- Data shows: Qodo consistently takes 7-8 minutes
- Adjustment: increase timeout to 10 minutes
- Result: fewer "TIMEOUT: Qodo didn't post" false alarms

### What's Tunable

| Parameter | Default | Adjustment Signal |
|-----------|---------|------------------|
| Review bot timeout | 5 min | Timeout frequency |
| Merge queue max depth | 4 | Queue ejection rate |
| Stuck detection threshold | 3 cycles | Escalation frequency |
| CI timeout | 15 min | CI timeout frequency |
| Health check retry count | 10 | False negative rate |
| Pipeline concurrency | 4 | Throughput vs conflict rate |

## Level 4: Cross-Repo Propagation

**What changes**: Rules and gates spread from one repo to all repos in the organization.

**Trigger**: A lesson learned in one repo is applicable to sibling repos.

**Mechanism**:
```
1. Repo A discovers a pattern (gotcha, gate, invariant)
2. Check: does this apply to other repos?
3. If yes: propagate the rule/gate to those repos
4. If no: keep it repo-specific
```

**Example**:
- Plugin repo A: discovered that `console.log` should be replaced with `ctx.log`
- Check: do all plugin repos have this pattern?
- Yes: all plugins should use `ctx.log`
- Propagate: add rule to all `wopr-plugin-*` repos

### Propagation Criteria

| Signal | Propagate? |
|--------|-----------|
| Repo-specific convention | No — only applies to that repo |
| Language/framework pattern | Maybe — applies to repos using that stack |
| Organizational convention | Yes — applies to all repos |
| Security invariant | Yes — always propagate security rules |

## Level 5: SOP Self-Evolution

**What changes**: The methodology itself — the pipeline stages, the role definitions, the gate taxonomy.

**Trigger**: The system encounters a class of problem that the current methodology doesn't address.

**Mechanism**:
```
1. A gap in the methodology is identified:
   - A stage is missing (e.g., no post-deploy verification existed)
   - A role is needed (e.g., QA team didn't exist)
   - A gate category is missing (e.g., no migration safety checks)
2. Design the addition
3. Document it in the methodology
4. Implement it in the concrete system
5. The methodology is now more complete
```

**Example**:
- Gap: deploys happened but nobody verified production was healthy
- Design: QA team with smoke tester, regression watcher, system observer
- Document: add `method/qa/` section to the methodology
- Implement: create QA agent definitions, integrate with deploy pipeline
- Result: the methodology now includes post-deploy verification

### The Meta-Feedback Loop

Level 5 is the methodology improving itself. The document you're reading right now is the product of Level 5 — someone identified that self-improvement needed to be documented, and documented it.

This is the only level that requires human judgment. An agent can add a gate (Level 1), update a prompt (Level 2), tune a config (Level 3), or propagate a rule (Level 4). But redesigning the methodology requires understanding the system holistically — something that currently requires human insight.

## Anti-Patterns

- **No feedback loop at all** — fixing problems without learning from them. The system never improves.
- **Only Level 1** — adding gates but never improving prompts or tuning configs. Gates alone can't fix process errors.
- **Skipping levels** — trying to do Level 5 (methodology evolution) without Level 1 (basic gate evolution). Build from the bottom up.
- **Over-tuning** — changing parameters after every data point instead of waiting for patterns. Tune based on trends, not outliers.
- **Propagating without validation** — pushing a rule from one repo to all repos without checking that it applies. Not every lesson is universal.
