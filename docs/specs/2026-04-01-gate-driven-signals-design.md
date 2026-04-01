# Gate-Driven Signals — Design Spec

**Problem:** The engineering flow depends on agents outputting exact signal strings (`spec_ready`, `pr_created`, `clean`, etc.) and structured artifact JSON. LLM agents are unreliable at outputting structured data consistently. When they don't, entities get stuck.

**Solution:** Invert the signal model. Instead of "agent decides the signal, engine executes it," use "agent says done, engine evaluates gates to determine what happened." Gates check external systems (GitHub) for evidence of completed work, extract artifacts, and determine the transition. Agent output format becomes irrelevant for the 80% of signals that correspond to externally observable outcomes.

**Goal:** Zero dependence on agent output format for artifact extraction. Fuzzy fallback for agent-judgment signals.

## Architecture

### Current Model (Fragile)
```
Agent outputs exact signal string → Engine matches transition → Gate evaluates → State changes
Agent outputs structured artifacts → Engine stores them → Next state prompt template uses them
```

### New Model (Robust)
```
Agent exits (any output) → Engine evaluates ALL outgoing gates → Gate results determine transition + extract artifacts → State changes
```

### Signal Categories

**Category A — Externally Observable (gate-driven, ~80% of transitions):**

| Current Signal | Gate Replacement | What Gate Checks |
|---|---|---|
| `spec_ready` | `spec-posted` | GitHub issue has comment matching "## Implementation Spec" |
| `pr_created` | `pr-exists` | GitHub PR exists from entity's branch pattern |
| `clean` | `review-approved` | PR has no unresolved review comments, all bots resolved |
| `ci_failed` | `ci-green` (already exists) | CI check runs status |
| `fixes_pushed` | `pr-updated` | PR head SHA changed since last review |
| `docs_ready` | `docs-committed` | PR has commits touching docs/ or README since last state |
| `merged` | `pr-mergeable` (already exists) | PR merged status |
| `blocked` | `pr-mergeable` (already exists) | PR blocked/conflict status |

**Category B — Agent Judgment (fuzzy signal matching, ~20%):**

| Signal | Why Gate Can't Determine It |
|---|---|
| `cant_resolve` | Agent's assessment that the findings contradict the spec — subjective |
| `cant_document` | Agent's assessment that docs can't be written — subjective |
| `closed` | Already handled by `pr-mergeable` gate outcome |

### Execution Flow

1. Agent receives prompt, does work, exits (outputs whatever it wants)
2. WorkerPool receives the SSE result
3. Instead of extracting a signal string, WorkerPool calls `engine.evaluateAndTransition(entityId)`
4. Engine evaluates all outgoing gates from the entity's current state
5. First gate that passes determines the transition AND extracts artifacts
6. If no gate passes, check for Category B fuzzy signal in agent output
7. If nothing matches, entity stays in current state — logged, retried on next claim

### Gate Artifact Extraction

Gates return both routing outcomes AND extracted data:

```typescript
// Current
{ outcome: "exists", message: "Matching comment found" }

// New
{ outcome: "exists", message: "Matching comment found", artifacts: { architectSpec: "<full comment body>" } }
```

Gate evaluator persists `artifacts` to entity when gate passes.

#### Per-Gate Extraction Contracts

**spec-posted:**
```typescript
// checkCommentExists enhanced
const match = comments.find((c) => regex.test(c.body));
return match
  ? { outcome: "exists", artifacts: { architectSpec: match.body } }
  : { outcome: "not_found" };
```

**pr-exists (NEW):**
```typescript
// New primitive op: vcs.pr_for_branch
// Checks if a PR exists from a branch matching a pattern
// Returns: { outcome: "exists", artifacts: { prUrl, prNumber, headSha, headBranch } }
//          { outcome: "not_found" }
```

**pr-updated (NEW):**
```typescript
// New primitive op: vcs.pr_head_changed
// Checks if PR head SHA differs from entity.artifacts.lastReviewedSha
// Returns: { outcome: "changed", artifacts: { headSha: newSha } }
//          { outcome: "unchanged" }
```

**review-approved (NEW):**
```typescript
// New primitive op: vcs.pr_review_status
// Checks unresolved review comments, bot statuses
// Returns: { outcome: "clean" }
//          { outcome: "has_issues", artifacts: { reviewFindings: extractedFindings } }
```

**docs-committed (NEW):**
```typescript
// New primitive op: vcs.files_changed_since
// Checks if docs files changed in PR since a given SHA
// Returns: { outcome: "changed" }
//          { outcome: "unchanged" }
```

### Fuzzy Signal Matching (Category B)

For agent-judgment signals, use a simple keyword classifier on the agent's final text output:

```typescript
function classifyAgentOutput(text: string): string | null {
  const lower = text.toLowerCase();
  
  // cant_resolve patterns
  if (/can'?t\s+resolve|cannot\s+resolve|unable\s+to\s+(fix|resolve)|contradicts?\s+(the\s+)?spec/i.test(lower)) {
    return "cant_resolve";
  }
  
  // cant_document patterns  
  if (/can'?t\s+document|cannot\s+document|unable\s+to\s+(write|create)\s+doc/i.test(lower)) {
    return "cant_document";
  }
  
  return null; // No judgment signal detected
}
```

No LLM call needed — regex is sufficient for these cases. The patterns are distinctive enough.

### Engine Changes

#### New method: `evaluateAndTransition`

```typescript
async evaluateAndTransition(
  entityId: string,
  agentOutput?: string,  // raw agent text for fuzzy matching
  agentArtifacts?: Record<string, unknown>,  // any structured artifacts agent DID provide
): Promise<ProcessSignalResult> {
  const entity = await this.entityRepo.get(entityId);
  const flow = await this.flowRepo.getAtVersion(entity.flowId, entity.flowVersion);
  
  // Get all outgoing transitions from current state
  const outgoing = flow.transitions.filter(t => t.fromState === entity.state);
  
  // Evaluate gates on each transition (priority-sorted)
  for (const transition of outgoing.sort((a, b) => b.priority - a.priority)) {
    if (!transition.gateId) continue;
    
    const gateResult = await this.resolveGate(transition.gateId, entity, flow);
    if (gateResult.kind === "proceed") {
      // Gate passed — extract artifacts and transition
      if (gateResult.artifacts) {
        await this.entityRepo.updateArtifacts(entityId, gateResult.artifacts);
      }
      return this.processSignal(entityId, transition.trigger, agentArtifacts);
    }
    if (gateResult.kind === "redirect") {
      // Gate redirected (e.g., CI failed → fix)
      if (gateResult.artifacts) {
        await this.entityRepo.updateArtifacts(entityId, gateResult.artifacts);
      }
      return this.processSignal(entityId, gateResult.trigger, agentArtifacts);
    }
  }
  
  // No gate passed — try fuzzy signal matching
  if (agentOutput) {
    const fuzzySignal = classifyAgentOutput(agentOutput);
    if (fuzzySignal) {
      return this.processSignal(entityId, fuzzySignal, agentArtifacts);
    }
  }
  
  // Nothing matched — entity stays in current state
  return { gated: true, gatesPassed: [], terminal: false };
}
```

#### Gate evaluator: persist extracted artifacts

When a gate result includes `artifacts`, the gate evaluator returns them to the engine for persistence:

```typescript
// In resolveGate return type, add:
artifacts?: Record<string, unknown>;
```

#### WorkerPool change

```typescript
// Current (worker-pool.ts:367-371)
if (signal) {
  const signalResult = await this.engine.processSignal(entityId, signal, resultArtifacts);
}

// New
const signalResult = await this.engine.evaluateAndTransition(
  entityId,
  body,  // raw SSE body for fuzzy matching
  resultArtifacts,  // any structured artifacts from agent
);
```

### Flow Definition Changes

All transitions need gates. New gates added for transitions that currently rely on agent signals:

```typescript
// New gates
{ name: "pr-exists", type: "primitive", primitiveOp: "vcs.pr_for_branch",
  primitiveParams: { branchPattern: "agent/{{entity.id}}/*" },
  outcomes: { exists: { proceed: true }, not_found: { proceed: false } } },

{ name: "review-approved", type: "primitive", primitiveOp: "vcs.pr_review_status",
  primitiveParams: { pullNumber: "{{entity.artifacts.prNumber}}" },
  outcomes: { clean: { proceed: true }, has_issues: { toState: "fix" } } },

{ name: "pr-updated", type: "primitive", primitiveOp: "vcs.pr_head_changed",
  primitiveParams: { pullNumber: "{{entity.artifacts.prNumber}}", lastSha: "{{entity.artifacts.lastReviewedSha}}" },
  outcomes: { changed: { proceed: true }, unchanged: { proceed: false } } },

{ name: "docs-committed", type: "primitive", primitiveOp: "vcs.files_changed_since",
  primitiveParams: { pullNumber: "{{entity.artifacts.prNumber}}", paths: "docs/,README*,*.md", sinceSha: "{{entity.artifacts.docsBaseSha}}" },
  outcomes: { changed: { proceed: true }, unchanged: { proceed: false } } },
```

Update `spec-posted` gate to include outcomes:
```typescript
{ name: "spec-posted", ..., outcomes: { exists: { proceed: true }, not_found: { proceed: false } } }
```

### Migration Path

1. **Phase 1**: Enhance existing gates to return artifacts (spec-posted, ci-green, pr-mergeable). Minimal changes.
2. **Phase 2**: Add new primitive ops (pr_for_branch, pr_review_status, pr_head_changed, files_changed_since).
3. **Phase 3**: Add `evaluateAndTransition` to engine. Wire WorkerPool to use it.
4. **Phase 4**: Add fuzzy signal classifier for Category B signals.
5. **Phase 5**: Remove exact-signal-match requirements from prompt templates. Simplify to "do the work, we'll check."

Each phase independently improves the system. Phase 1 alone solves the architectSpec handoff.

### What Doesn't Change

- Flow definition structure (states, transitions, gates)
- IFlowEngine interface (claim/report still works for external callers)
- WorkerPool lifecycle (provision → dispatch → teardown)
- Gate evaluation logic (just returns more data)
- Prompt templates (still use `{{entity.artifacts.X}}` — just populated by gates now)
- Entity/invocation data model
