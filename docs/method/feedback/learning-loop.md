# Learning Loop

How findings become rules and rules become gates — the system that gets smarter over time.

---

## The Core Loop

```
Problem occurs
  ↓
Caught by: review / gate / incident
  ↓
Fixed manually
  ↓
Same problem occurs again
  ↓
Added as a rule (agents read before coding)
  ↓
Same problem occurs a third time
  ↓
Promoted to a gate (automated check in CI)
  ↓
Problem can never reach production again
```

This is the fundamental feedback loop. Every class of error follows this progression: unknown → known → prevented.

## The Three Stages of Error Prevention

### Stage 1: Unknown (Caught in Review)

The first time a problem appears, nobody knows about it. It's caught by a reviewer (human or agent) who notices something wrong.

**Action**: Fix the problem. Make a note. Move on.

At this stage, the problem is anecdotal. It might be a one-off mistake or it might be a pattern. You don't know yet.

### Stage 2: Known (Documented as a Rule)

The second time the same class of problem appears, it's a pattern. Add it to the agent's rule file:

```
## Gotchas

- **auth**: Never store session tokens in localStorage — use httpOnly cookies.
  First seen: PR #42. Recurred: PR #67.
```

Now every agent that operates in this repo reads this rule before writing code. The rule doesn't prevent the problem mechanically — it relies on the agent to follow instructions. But it's a significant improvement over "hope the reviewer catches it."

### Stage 3: Prevented (Automated as a Gate)

The third time the same class of problem appears despite being documented as a rule, it's time to automate:

```
CI gate: scan for localStorage.setItem("session") in source code
  → if found: block the PR
  → message: "Session tokens must use httpOnly cookies, not localStorage"
```

Now the problem cannot reach production. The gate catches it mechanically, regardless of whether the agent read the rule or the reviewer noticed.

## What Gets Promoted

Not every finding should become a gate. Gates have a cost (maintenance, CI time, false positives). Promote based on:

| Signal | Action |
|--------|--------|
| One-off mistake, clear context | Fix it. Don't add a rule. |
| Same mistake by different agents | Add a rule. |
| Rule exists but keeps being violated | Promote to gate. |
| Security issue (any severity) | Promote to gate immediately. |
| Issue that caused a production incident | Promote to gate immediately. |

### The Cost-Benefit Test

Before promoting to a gate, ask:
1. How often does this problem occur? (frequency)
2. How bad is it when it does? (severity)
3. How hard is it to detect mechanically? (automability)
4. How many false positives will the gate produce? (noise)

High frequency + high severity + easy detection + low false positives = promote now.
Low frequency + low severity + hard detection + high false positives = keep as rule.

## Rule File Maintenance

Rules accumulate. Without maintenance, the rule file becomes a dumping ground of outdated advice:

### When to Update Rules

- **After promoting to a gate**: remove the rule. The gate handles it now.
- **After a codebase change**: if the pattern the rule warns about no longer exists, remove the rule.
- **After consolidation**: merge related rules into one. Three rules about import patterns become one "import boundaries" rule.

### When to Keep Rules

- **Non-automatable gotchas**: "Container naming uses `wopr-` prefix" can't easily be a gate, but it's essential knowledge.
- **Contextual advice**: "Tests OOM in worktrees" is a gotcha, not a gateable condition.
- **Architectural invariants**: "Never import from `../core/internal`" could be a gate but is also valuable as documentation.

### Size Limits

Rule files should stay under a manageable size (e.g., 200 lines). When a rule file grows beyond this:
1. Move detailed sections to separate files
2. Keep the main rule file as an index
3. Merge related one-liners into consolidated rules

## Gate Evolution

Gates themselves evolve:

```
v1: grep for "localStorage.setItem" → block if found
  ↓ too many false positives (test fixtures use localStorage)
v2: grep for "localStorage.setItem" outside test files → block if found
  ↓ discovered a legitimate use case (admin debug panel)
v3: grep for "localStorage.setItem" outside test/ and admin/ → block if found
```

Gates that produce too many false positives erode trust in the gate system. If a gate is wrong more often than it's right, agents and humans learn to ignore it (or find ways around it). Fix the gate, don't disable it.

## Cross-Repo Propagation

When a lesson is learned in one repo, consider whether it applies to others:

```
Repo A: discovered that command injection via exec() was possible
  ↓
Added rule to Repo A: "Never pass user input to exec() without validation"
  ↓
Question: does this apply to Repo B, C, D?
  ↓
If yes: add the rule (or gate) to those repos too
```

Cross-repo propagation prevents the same class of bug from appearing in every repo sequentially. Learn once, apply everywhere.

## Anti-Patterns

- **No learning** — fixing problems without recording them. The same mistake will recur.
- **Rules without promotion** — documenting everything as rules but never automating. The rule file grows unbounded while the same problems keep slipping through.
- **Gates without tuning** — deploying a gate and never adjusting it. False positives accumulate, trust erodes.
- **Promoting too eagerly** — making every one-off mistake into a gate. Gates have maintenance cost. Only promote patterns.
- **Learning in silos** — one repo learns a lesson, but other repos in the organization don't benefit. Propagate.
