import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import { createScopedRepos } from "../../src/repositories/scoped-repos.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { provisionEngineeringFlow } from "../../src/flows/provision.js";
import {
  ENGINEERING_FLOW,
  STATES,
  GATES,
  TRANSITIONS,
  GATE_WIRING,
} from "../../src/flows/engineering.js";
import type { PGlite } from "@electric-sql/pglite";

describe("Engineering flow definition", () => {
  it("has correct initial state", () => {
    expect(ENGINEERING_FLOW.initialState).toBe("spec");
  });

  it("defines 10 states", () => {
    expect(STATES).toHaveLength(10);
    const names = STATES.map((s) => s.name);
    expect(names).toContain("spec");
    expect(names).toContain("code");
    expect(names).toContain("review");
    expect(names).toContain("fix");
    expect(names).toContain("docs");
    expect(names).toContain("merge");
    expect(names).toContain("done");
    expect(names).toContain("stuck");
    expect(names).toContain("cancelled");
    expect(names).toContain("budget_exceeded");
  });

  it("defines 7 gates", () => {
    expect(GATES).toHaveLength(7);
    const names = GATES.map((g) => g.name);
    expect(names).toEqual(["spec-posted", "ci-green", "pr-mergeable", "pr-exists", "review-status", "pr-updated", "docs-committed"]);
  });

  it("defines 12 transitions covering full flow graph", () => {
    expect(TRANSITIONS).toHaveLength(12);
  });

  it("spec-posted gate has outcomes map and artifactKey", () => {
    const specGate = GATES.find((g) => g.name === "spec-posted");
    expect(specGate?.outcomes).toEqual({
      exists: { proceed: true },
      not_found: { proceed: false },
    });
    expect(specGate?.primitiveParams?.artifactKey).toBe("architectSpec");
  });

  it("has gate wiring for spec→code, code→review, merge→done", () => {
    expect(GATE_WIRING["spec-posted"]).toEqual({ fromState: "spec", trigger: "spec_ready" });
    expect(GATE_WIRING["ci-green"]).toEqual({ fromState: "code", trigger: "pr_created" });
    expect(GATE_WIRING["pr-mergeable"]).toEqual({ fromState: "merge", trigger: "merged" });
  });

  it("all active states have prompt templates", () => {
    const active = STATES.filter((s) => s.mode === "active");
    for (const state of active) {
      expect(state.promptTemplate, `${state.name} missing prompt`).toBeTruthy();
    }
  });

  it("terminal states have no prompt templates", () => {
    const passive = STATES.filter((s) => s.mode === "passive");
    for (const state of passive) {
      expect(state.promptTemplate, `${state.name} should not have prompt`).toBeUndefined();
    }
  });

  it("review→fix loop exists", () => {
    const reviewToFix = TRANSITIONS.filter((t) => t.fromState === "review" && t.toState === "fix");
    expect(reviewToFix.length).toBeGreaterThanOrEqual(1);
    const fixToReview = TRANSITIONS.find((t) => t.fromState === "fix" && t.toState === "review");
    expect(fixToReview).toBeDefined();
  });

  it("merge→fix loop exists", () => {
    const mergeToFix = TRANSITIONS.find((t) => t.fromState === "merge" && t.toState === "fix");
    expect(mergeToFix).toBeDefined();
  });
});

/**
 * Provision the engineering flow WITHOUT gates so we can test the
 * transition graph in isolation. Gates are tested separately.
 */
async function provisionUngatedFlow(
  flowRepo: ReturnType<typeof createScopedRepos>["flows"],
  gateRepo: ReturnType<typeof createScopedRepos>["gates"],
) {
  const existing = await flowRepo.getByName(ENGINEERING_FLOW.name);
  if (existing) return { flowId: existing.id };

  const flow = await flowRepo.create(ENGINEERING_FLOW);
  for (const state of STATES) {
    await flowRepo.addState(flow.id, state);
  }
  // Add transitions WITHOUT gate wiring — pure transition graph
  for (const transition of TRANSITIONS) {
    await flowRepo.addTransition(flow.id, transition);
  }
  return { flowId: flow.id };
}

describe("Engineering flow provisioning", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;
  });

  afterAll(async () => {
    await close();
  });

  it("provisions the engineering flow with gates", async () => {
    const repos = createScopedRepos(db, "provision-test");
    const { flowId } = await provisionEngineeringFlow(repos.flows, repos.gates);
    expect(flowId).toBeTruthy();

    const flow = await repos.flows.getByName("engineering");
    expect(flow).not.toBeNull();
    expect(flow!.initialState).toBe("spec");
    expect(flow!.states).toHaveLength(10);
    expect(flow!.transitions).toHaveLength(12);
  });

  it("provisioning is idempotent", async () => {
    const repos = createScopedRepos(db, "provision-test");
    const { flowId: first } = await provisionEngineeringFlow(repos.flows, repos.gates);
    const { flowId: second } = await provisionEngineeringFlow(repos.flows, repos.gates);
    expect(first).toBe(second);
  });

  it("gated transitions have gateIds set", async () => {
    const repos = createScopedRepos(db, "provision-test");
    const flow = await repos.flows.getByName("engineering");
    expect(flow).not.toBeNull();

    // spec→code should be gated by spec-posted
    const specToCode = flow!.transitions.find(
      (t) => t.fromState === "spec" && t.trigger === "spec_ready",
    );
    expect(specToCode?.gateId).toBeTruthy();

    // code→review should be gated by ci-green
    const codeToReview = flow!.transitions.find(
      (t) => t.fromState === "code" && t.trigger === "pr_created",
    );
    expect(codeToReview?.gateId).toBeTruthy();

    // merge→done should be gated by pr-mergeable
    const mergeToDone = flow!.transitions.find(
      (t) => t.fromState === "merge" && t.trigger === "merged",
    );
    expect(mergeToDone?.gateId).toBeTruthy();
  });
});

describe("Engineering flow transition graph", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let engine: Engine;

  beforeAll(async () => {
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    const repos = createScopedRepos(db, "transition-test");
    const eventEmitter = new EventEmitter();

    engine = new Engine({
      entityRepo: repos.entities,
      flowRepo: repos.flows,
      invocationRepo: repos.invocations,
      gateRepo: repos.gates,
      transitionLogRepo: repos.transitionLog,
      adapters: new Map(),
      eventEmitter,
    });

    // Provision without gates for clean transition testing
    await provisionUngatedFlow(repos.flows, repos.gates);
  });

  afterAll(async () => {
    await close();
  });

  async function createEntity(issueNumber: number) {
    return engine.createEntity("engineering", undefined, {
      issueNumber,
      issueTitle: `Test issue #${issueNumber}`,
      issueBody: "test body",
      repoFullName: "acme/webapp",
    });
  }

  it("creates entity in spec state", async () => {
    const entity = await createEntity(1);
    expect(entity.state).toBe("spec");
    expect(entity.artifacts?.issueNumber).toBe(1);
  });

  it("spec → code on spec_ready", async () => {
    const entity = await createEntity(2);
    const result = await engine.processSignal(entity.id, "spec_ready", {
      architectSpec: "## Spec\nDo the thing",
    });
    expect(result.newState).toBe("code");
    expect(result.gated).toBe(false);
  });

  it("code → review on pr_created", async () => {
    const entity = await createEntity(3);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    const result = await engine.processSignal(entity.id, "pr_created", {
      prUrl: "https://github.com/acme/webapp/pull/10",
      prNumber: 10,
    });
    expect(result.newState).toBe("review");
  });

  it("review → docs on clean", async () => {
    const entity = await createEntity(4);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    const result = await engine.processSignal(entity.id, "clean");
    expect(result.newState).toBe("docs");
  });

  it("review → fix on issues", async () => {
    const entity = await createEntity(5);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    const result = await engine.processSignal(entity.id, "issues", {
      reviewFindings: "Bug on line 42",
    });
    expect(result.newState).toBe("fix");
  });

  it("review → fix on ci_failed", async () => {
    const entity = await createEntity(6);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    const result = await engine.processSignal(entity.id, "ci_failed");
    expect(result.newState).toBe("fix");
  });

  it("fix → review on fixes_pushed (loop)", async () => {
    const entity = await createEntity(7);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "issues", { reviewFindings: "Bug" });
    const result = await engine.processSignal(entity.id, "fixes_pushed");
    expect(result.newState).toBe("review");
  });

  it("fix → stuck on cant_resolve", async () => {
    const entity = await createEntity(8);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "issues", { reviewFindings: "Unfixable" });
    const result = await engine.processSignal(entity.id, "cant_resolve");
    expect(result.newState).toBe("stuck");
  });

  it("docs → merge on docs_ready", async () => {
    const entity = await createEntity(9);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "clean");
    const result = await engine.processSignal(entity.id, "docs_ready");
    expect(result.newState).toBe("merge");
  });

  it("docs → stuck on cant_document", async () => {
    const entity = await createEntity(10);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "clean");
    const result = await engine.processSignal(entity.id, "cant_document");
    expect(result.newState).toBe("stuck");
  });

  it("merge → done on merged", async () => {
    const entity = await createEntity(12);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "clean");
    await engine.processSignal(entity.id, "docs_ready");
    const result = await engine.processSignal(entity.id, "merged");
    expect(result.newState).toBe("done");
  });

  it("merge → fix on blocked", async () => {
    const entity = await createEntity(13);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "clean");
    await engine.processSignal(entity.id, "docs_ready");
    const result = await engine.processSignal(entity.id, "blocked");
    expect(result.newState).toBe("fix");
  });

  it("merge → stuck on closed", async () => {
    const entity = await createEntity(14);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "clean");
    await engine.processSignal(entity.id, "docs_ready");
    const result = await engine.processSignal(entity.id, "closed");
    expect(result.newState).toBe("stuck");
  });

  it("happy path: spec → code → review → docs → merge → done", async () => {
    const entity = await createEntity(100);
    expect(entity.state).toBe("spec");

    const r1 = await engine.processSignal(entity.id, "spec_ready", { architectSpec: "## Spec" });
    expect(r1.newState).toBe("code");

    const r2 = await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    expect(r2.newState).toBe("review");

    const r3 = await engine.processSignal(entity.id, "clean");
    expect(r3.newState).toBe("docs");

    const r4 = await engine.processSignal(entity.id, "docs_ready");
    expect(r4.newState).toBe("merge");

    const r5 = await engine.processSignal(entity.id, "merged");
    expect(r5.newState).toBe("done");
  });

  it("review/fix loop then success", async () => {
    const entity = await createEntity(200);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });

    // First review finds issues
    const r1 = await engine.processSignal(entity.id, "issues", { reviewFindings: "Bug" });
    expect(r1.newState).toBe("fix");

    // Fix and re-review
    const r2 = await engine.processSignal(entity.id, "fixes_pushed");
    expect(r2.newState).toBe("review");

    // Second review is clean
    const r3 = await engine.processSignal(entity.id, "clean");
    expect(r3.newState).toBe("docs");
  });

  it("merge blocked → fix → review → docs → merge → done", async () => {
    const entity = await createEntity(300);
    await engine.processSignal(entity.id, "spec_ready", { architectSpec: "spec" });
    await engine.processSignal(entity.id, "pr_created", { prUrl: "url", prNumber: 1 });
    await engine.processSignal(entity.id, "clean");
    await engine.processSignal(entity.id, "docs_ready");

    // Merge blocked
    const r1 = await engine.processSignal(entity.id, "blocked");
    expect(r1.newState).toBe("fix");

    // Fix, re-review, re-merge
    const r2 = await engine.processSignal(entity.id, "fixes_pushed");
    expect(r2.newState).toBe("review");

    const r3 = await engine.processSignal(entity.id, "clean");
    expect(r3.newState).toBe("docs");

    const r4 = await engine.processSignal(entity.id, "docs_ready");
    expect(r4.newState).toBe("merge");

    const r5 = await engine.processSignal(entity.id, "merged");
    expect(r5.newState).toBe("done");
  });
});
