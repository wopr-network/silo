# Multi-Repo Entity Support — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a single entity to span multiple repos — one worktree per repo, one PR per repo, gate evaluation loops over all repos.

**Architecture:** The `**Repo:**` line in issue descriptions is parsed into an array (always an array, even for one repo). This array flows through onEnter (nuke provisions N worktrees), agent execution (prompt lists all worktree paths), and gate evaluation (engine calls gate script once per repo/PR pair, ANDs results).

**Tech Stack:** TypeScript, Zod, Vitest, shell scripts (gates)

**Spec:** `docs/specs/2026-03-10-multi-repo-entity-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sources/linear/repo-extractor.ts` | Modify | Parse `**Repo:**` line into array instead of single string |
| `src/sources/linear/webhook-handler.ts` | Modify | Pass repos array into payload instead of single `github.repo` |
| `src/sources/linear/poller.ts` | Modify | Same — uses `extractRepoFromDescription` |
| `src/run-loop/run-loop.ts` | Modify | Same — uses `extractRepoFromDescription` |
| `src/engine/gate-evaluator.ts` | Modify | Add `evaluateGateMultiRepo` that loops over repos, ANDs results |
| `src/engine/engine.ts` | Modify | Call multi-repo gate evaluator when `artifacts.prs` is a map |
| `tests/sources/linear/repo-extractor.test.ts` | Create | Tests for multi-repo parsing |
| `tests/sources/linear/webhook-handler.test.ts` | Create | Tests for webhook payload with repos array |
| `tests/engine/gate-evaluator-multi-repo.test.ts` | Create | Tests for multi-repo gate evaluation |

**Out of scope (separate PRs):**
- `nuke` changes (provision-worktree loop) — separate repo, separate PR
- `cheyenne-mountain` gate scripts — no changes needed (already take `PR_NUMBER REPO`)

---

## Chunk 1: Repo Extractor — Parse Multi-Repo Descriptions

### Task 1: Update `extractRepoFromDescription` to return an array

**Files:**
- Modify: `src/sources/linear/repo-extractor.ts`
- Create: `tests/sources/linear/repo-extractor.test.ts`

- [ ] **Step 1: Write failing tests for the new behavior**

```typescript
// tests/sources/linear/repo-extractor.test.ts
import { describe, expect, it } from "vitest";
import { extractReposFromDescription } from "../../../src/sources/linear/repo-extractor.js";

describe("extractReposFromDescription", () => {
  it("returns empty array when description is null", () => {
    expect(extractReposFromDescription(null)).toEqual([]);
  });

  it("returns empty array when no Repo line exists", () => {
    expect(extractReposFromDescription("Just a description")).toEqual([]);
  });

  it("parses a single repo", () => {
    const desc = "**Repo:** wopr-network/wopr-platform\n\nSome description";
    expect(extractReposFromDescription(desc)).toEqual(["wopr-network/wopr-platform"]);
  });

  it("parses multiple repos separated by +", () => {
    const desc = "**Repo:** wopr-network/wopr-platform + wopr-network/platform-core\n\nDetails";
    expect(extractReposFromDescription(desc)).toEqual([
      "wopr-network/wopr-platform",
      "wopr-network/platform-core",
    ]);
  });

  it("parses three repos", () => {
    const desc = "**Repo:** wopr-network/a + wopr-network/b + wopr-network/c";
    expect(extractReposFromDescription(desc)).toEqual([
      "wopr-network/a",
      "wopr-network/b",
      "wopr-network/c",
    ]);
  });

  it("trims whitespace around repo names", () => {
    const desc = "**Repo:**   wopr-network/foo  +  wopr-network/bar  ";
    expect(extractReposFromDescription(desc)).toEqual([
      "wopr-network/foo",
      "wopr-network/bar",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/sources/linear/repo-extractor.test.ts
```

Expected: FAIL — `extractReposFromDescription` does not exist.

- [ ] **Step 3: Implement `extractReposFromDescription`**

```typescript
// src/sources/linear/repo-extractor.ts
const REPO_LINE_PATTERN = /\*\*Repo:\*\*[^\S\n]+(.+)/;

/**
 * @deprecated Use extractReposFromDescription instead.
 */
export function extractRepoFromDescription(description: string | null): string | null {
  const repos = extractReposFromDescription(description);
  return repos.length > 0 ? repos[0] : null;
}

export function extractReposFromDescription(description: string | null): string[] {
  if (!description) return [];
  const match = REPO_LINE_PATTERN.exec(description);
  if (!match) return [];
  return match[1]
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/sources/linear/repo-extractor.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
npx vitest run
```

The old `extractRepoFromDescription` is preserved as a deprecated wrapper, so all existing callers still work.

- [ ] **Step 6: Commit**

```bash
git add src/sources/linear/repo-extractor.ts tests/sources/linear/repo-extractor.test.ts
git commit -m "feat: extractReposFromDescription parses multi-repo Repo lines"
```

---

### Task 2: Update webhook handler to pass repos array

**Files:**
- Modify: `src/sources/linear/webhook-handler.ts`
- Create: `tests/sources/linear/webhook-handler.test.ts`

- [ ] **Step 1: Write failing test for repos array in payload**

```typescript
// tests/sources/linear/webhook-handler.test.ts
import { describe, expect, it } from "vitest";
import { handleLinearWebhook } from "../../../src/sources/linear/webhook-handler.js";

const baseWatch = {
  sourceId: "src-1",
  flowName: "default",
  signal: "start",
  filter: {},
};

function makePayload(description: string | null) {
  return {
    action: "create" as const,
    type: "Issue",
    data: {
      id: "issue-1",
      identifier: "WOP-2104",
      title: "Test issue",
      description,
    },
  };
}

describe("handleLinearWebhook — repos array", () => {
  it("sets payload.repos from single-repo description", () => {
    const event = handleLinearWebhook(
      makePayload("**Repo:** wopr-network/wopr-platform\n\nDetails"),
      baseWatch,
    );
    expect(event).not.toBeNull();
    expect(event!.payload!.repos).toEqual(["wopr-network/wopr-platform"]);
  });

  it("sets payload.repos from multi-repo description", () => {
    const event = handleLinearWebhook(
      makePayload("**Repo:** wopr-network/wopr-platform + wopr-network/platform-core"),
      baseWatch,
    );
    expect(event).not.toBeNull();
    expect(event!.payload!.repos).toEqual([
      "wopr-network/wopr-platform",
      "wopr-network/platform-core",
    ]);
  });

  it("sets empty repos array when no Repo line", () => {
    const event = handleLinearWebhook(
      makePayload("Just a description with no repo line"),
      baseWatch,
    );
    expect(event).not.toBeNull();
    expect(event!.payload!.repos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/sources/linear/webhook-handler.test.ts
```

Expected: FAIL — `payload.repos` is undefined.

- [ ] **Step 3: Update webhook handler to include repos array**

In `src/sources/linear/webhook-handler.ts`:

Change the import:

```typescript
import { extractReposFromDescription } from "./repo-extractor.js";
```

Change line 61 and the return block (lines 60–84):

```typescript
  const description = data.description ?? null;
  const repos = extractReposFromDescription(description);

  const signal = watch.signal ?? undefined;

  return {
    sourceId: watch.sourceId,
    externalId: data.id,
    type: "new",
    flowName: watch.flowName,
    signal,
    payload: {
      repos,
      refs: {
        linear: {
          id: data.id,
          key: data.identifier,
          title: data.title,
          description,
        },
        github: { repo: repos[0] ?? null },
      },
    },
  };
```

Note: `github.repo` is kept for backwards compatibility (existing templates reference `{{entity.artifacts.refs.github.repo}}`). It points to the first repo. New code should use `payload.repos`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/sources/linear/webhook-handler.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/sources/linear/webhook-handler.ts tests/sources/linear/webhook-handler.test.ts
git commit -m "feat: webhook handler includes repos array in payload"
```

---

### Task 3: Update poller and run-loop to use new extractor

**Files:**
- Modify: `src/sources/linear/poller.ts`
- Modify: `src/run-loop/run-loop.ts`

- [ ] **Step 1: Update poller.ts import and usage**

In `src/sources/linear/poller.ts`, find the import of `extractRepoFromDescription` and the line that calls it. Change to `extractReposFromDescription` and set `payload.repos` the same way as the webhook handler. Keep `github.repo` pointing to `repos[0] ?? null` for backwards compat.

- [ ] **Step 2: Update run-loop.ts import and usage**

Same pattern as poller.ts.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/sources/linear/poller.ts src/run-loop/run-loop.ts
git commit -m "refactor: poller and run-loop use extractReposFromDescription"
```

---

## Chunk 2: Gate Evaluator — Multi-Repo Loop

### Task 4: Add multi-repo gate evaluation

**Files:**
- Modify: `src/engine/gate-evaluator.ts`
- Create: `tests/engine/gate-evaluator-multi-repo.test.ts`

- [ ] **Step 1: Write failing tests for multi-repo gate evaluation**

```typescript
// tests/engine/gate-evaluator-multi-repo.test.ts
import { describe, expect, it, vi } from "vitest";
import { evaluateGateForAllRepos } from "../../src/engine/gate-evaluator.js";
import type { Entity, Gate, IGateRepository } from "../../src/repositories/interfaces.js";

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    id: "gate-1",
    name: "pr-posted",
    flowId: "flow-1",
    transitionId: "t-1",
    type: "command",
    command: "gates/review-bots-ready.sh {{prNumber}} {{repo}}",
    outcomes: null,
    timeoutMs: null,
    functionRef: null,
    apiConfig: null,
    ...overrides,
  };
}

function makeEntity(artifacts: Record<string, unknown>): Entity {
  return {
    id: "entity-1",
    flowId: "flow-1",
    state: "reviewing",
    refs: null,
    artifacts,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Entity;
}

const mockGateRepo = {
  get: vi.fn(),
  record: vi.fn(),
  resultsFor: vi.fn(),
} as unknown as IGateRepository;

describe("evaluateGateForAllRepos", () => {
  it("returns passed=true when all repos pass", async () => {
    const entity = makeEntity({
      repos: ["wopr-network/wopr-platform", "wopr-network/platform-core"],
      prs: {
        "wopr-platform": "https://github.com/wopr-network/wopr-platform/pull/10",
        "platform-core": "https://github.com/wopr-network/platform-core/pull/20",
      },
    });
    // Mock evaluateGate to always pass
    const evalFn = vi.fn().mockResolvedValue({ passed: true, timedOut: false, output: "ok" });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.passed).toBe(true);
    expect(evalFn).toHaveBeenCalledTimes(2);
  });

  it("returns passed=false when one repo fails", async () => {
    const entity = makeEntity({
      repos: ["wopr-network/wopr-platform", "wopr-network/platform-core"],
      prs: {
        "wopr-platform": "https://github.com/wopr-network/wopr-platform/pull/10",
        "platform-core": "https://github.com/wopr-network/platform-core/pull/20",
      },
    });
    const evalFn = vi
      .fn()
      .mockResolvedValueOnce({ passed: true, timedOut: false, output: "ok" })
      .mockResolvedValueOnce({ passed: false, timedOut: false, output: "CI failed" });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.passed).toBe(false);
  });

  it("falls back to single evaluation when no prs map exists", async () => {
    const entity = makeEntity({});
    const evalFn = vi.fn().mockResolvedValue({ passed: true, timedOut: false, output: "ok" });

    const result = await evaluateGateForAllRepos(makeGate(), entity, mockGateRepo, null, evalFn);
    expect(result.passed).toBe(true);
    expect(evalFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/engine/gate-evaluator-multi-repo.test.ts
```

Expected: FAIL — `evaluateGateForAllRepos` does not exist.

- [ ] **Step 3: Implement `evaluateGateForAllRepos`**

Add to `src/engine/gate-evaluator.ts`:

```typescript
/**
 * Evaluate a gate across all repos in the entity's artifacts.prs map.
 * Calls evalFn once per repo/PR pair and ANDs the results.
 * Falls back to a single evalFn call when no prs map exists.
 */
export async function evaluateGateForAllRepos(
  gate: Gate,
  entity: Entity,
  gateRepo: IGateRepository,
  flowGateTimeoutMs?: number | null,
  evalFn: (gate: Gate, entity: Entity, gateRepo: IGateRepository, timeout?: number | null) => Promise<GateEvalResult> = evaluateGate,
): Promise<GateEvalResult> {
  const prs = entity.artifacts?.prs;

  // No prs map — single evaluation (backwards compat, or non-PR gate like spec-posted)
  if (!prs || typeof prs !== "object" || Object.keys(prs).length === 0) {
    return evalFn(gate, entity, gateRepo, flowGateTimeoutMs);
  }

  const entries = Object.entries(prs as Record<string, string>);
  const results: GateEvalResult[] = [];

  for (const [repoName, prUrl] of entries) {
    // Extract PR number from URL (e.g. https://github.com/org/repo/pull/123 → 123)
    const prNumber = prUrl.split("/").pop() ?? "";
    const fullRepo = (entity.artifacts?.repos as string[] | undefined)?.find((r: string) => r.endsWith(`/${repoName}`)) ?? repoName;

    // Create a per-repo entity view with repo-specific context for template rendering
    const repoEntity: Entity = {
      ...entity,
      artifacts: {
        ...entity.artifacts,
        _currentRepo: fullRepo,
        _currentRepoName: repoName,
        _currentPrNumber: prNumber,
        _currentPrUrl: prUrl,
      },
    };

    const result = await evalFn(gate, repoEntity, gateRepo, flowGateTimeoutMs);
    results.push(result);

    // Short-circuit on first failure
    if (!result.passed) {
      return {
        passed: false,
        timedOut: result.timedOut,
        output: `[${repoName}] ${result.output}`,
        outcome: result.outcome,
        message: result.message,
      };
    }
  }

  // All passed
  const lastResult = results[results.length - 1]!;
  return {
    passed: true,
    timedOut: false,
    output: results.map((r, i) => `[${entries[i][0]}] ${r.output}`).join("\n"),
    outcome: lastResult.outcome,
    message: lastResult.message,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/engine/gate-evaluator-multi-repo.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/engine/gate-evaluator.ts tests/engine/gate-evaluator-multi-repo.test.ts
git commit -m "feat: evaluateGateForAllRepos loops over repos and ANDs results"
```

---

### Task 5: Wire multi-repo gate evaluator into engine

**Files:**
- Modify: `src/engine/engine.ts`

- [ ] **Step 1: Import `evaluateGateForAllRepos` in engine.ts**

At line 20 (the existing import of `evaluateGate`), add `evaluateGateForAllRepos`:

```typescript
import { evaluateGate, evaluateGateForAllRepos } from "./gate-evaluator.js";
```

- [ ] **Step 2: Update `resolveGate` to use multi-repo evaluator**

In `src/engine/engine.ts`, in the `resolveGate` method, change line 484 from:

```typescript
const gateResult = await evaluateGate(gate, entity, gateRepo, flow.gateTimeoutMs);
```

to:

```typescript
const gateResult = await evaluateGateForAllRepos(gate, entity, gateRepo, flow.gateTimeoutMs);
```

This is the only callsite. `evaluateGateForAllRepos` falls back to single evaluation when no `prs` map exists, so all existing behavior is preserved.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

All existing gate tests should still pass since `evaluateGateForAllRepos` delegates to `evaluateGate` for entities without a `prs` map.

- [ ] **Step 4: Commit**

```bash
git add src/engine/engine.ts
git commit -m "feat: engine uses multi-repo gate evaluator"
```

---

## Chunk 3: Nuke Changes (Separate Repo)

> These changes go in `~/nuke`, not `~/silo`. Separate PR.

### Task 6: Update nuke checkout endpoint to handle repos array

**Files:**
- Modify: `~/nuke/packages/worker-runtime/src/server.ts`

The nuke checkout endpoint currently accepts a single `repo` string. It needs to also accept a `repos` array and provision one worktree per repo.

- [ ] **Step 1: Add repos array handling to checkout endpoint**

In the `/checkout` handler in `server.ts`, after parsing the request body:

```typescript
// Accept either `repo` (string) or `repos` (array)
const repoList: string[] = Array.isArray(body.repos)
  ? body.repos
  : body.repo
    ? [body.repo]
    : [];

if (repoList.length === 0) {
  res.writeHead(400).end("Missing required field: repo or repos");
  return;
}

const entityDir = body.entityId ? join(WORKSPACE, body.entityId) : WORKSPACE;
await mkdir(entityDir, { recursive: true });

const worktrees: Record<string, string> = {};

for (const repo of repoList) {
  const repoName = repo.split("/").pop() ?? repo;
  const worktreePath = join(entityDir, repoName);

  // Clone or fetch (existing logic, but into entityDir/repoName)
  if (!existsSync(worktreePath)) {
    await execFileAsync("gh", ["repo", "clone", repo, worktreePath], { env });
  } else {
    await execFileAsync("git", ["-C", worktreePath, "fetch", "origin"], { env });
  }

  // Branch checkout (existing logic)
  // ...

  worktrees[repoName] = worktreePath;
}

res
  .writeHead(200, { "Content-Type": "application/json" })
  .end(JSON.stringify({ worktrees }));
```

- [ ] **Step 2: Test manually with curl**

```bash
curl -X POST http://localhost:8080/checkout \
  -H "Content-Type: application/json" \
  -d '{"repos": ["wopr-network/wopr-platform", "wopr-network/platform-core"], "entityId": "test-123"}'
```

Expected: `{ "worktrees": { "wopr-platform": "/workspace/test-123/wopr-platform", "platform-core": "/workspace/test-123/platform-core" } }`

- [ ] **Step 3: Verify single-repo backwards compat**

```bash
curl -X POST http://localhost:8080/checkout \
  -H "Content-Type: application/json" \
  -d '{"repo": "wopr-network/silo"}'
```

Expected: `{ "worktrees": { "silo": "/workspace/silo" } }`

- [ ] **Step 4: Commit**

```bash
cd ~/nuke
git add packages/worker-runtime/src/server.ts
git commit -m "feat: checkout endpoint supports repos array for multi-repo entities"
```

---

## Summary

| Task | Repo | What |
|------|------|------|
| 1 | silo | `extractReposFromDescription` returns array |
| 2 | silo | Webhook handler passes `payload.repos` |
| 3 | silo | Poller + run-loop use new extractor |
| 4 | silo | `evaluateGateForAllRepos` — loops, ANDs |
| 5 | silo | Engine wired to multi-repo evaluator |
| 6 | nuke | Checkout endpoint handles repos array |

**Backwards compatible:** Single-repo issues produce `repos: ["wopr-network/whatever"]`. Loops run once. Gate scripts unchanged. Nuke accepts both `repo` (string) and `repos` (array).
