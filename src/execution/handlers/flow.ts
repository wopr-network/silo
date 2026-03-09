import { DEFAULT_TIMEOUT_PROMPT } from "../../engine/constants.js";
import type { McpServerDeps } from "../mcp-helpers.js";
import { errorResult, jsonResult, validateInput } from "../mcp-helpers.js";
import { FlowClaimSchema, FlowFailSchema, FlowGetPromptSchema, FlowReportSchema } from "../tool-schemas.js";

const RETRY_SHORT_MS = 30_000; // entities exist but all claimed
const RETRY_LONG_MS = 300_000; // backlog empty — fallback when no per-flow/state config

/**
 * Resolve the check_back delay for a "no work" response.
 * Priority: state.retryAfterMs > flow.claimRetryAfterMs > RETRY_LONG_MS
 */
function resolveRetryMs(flows: import("../../repositories/interfaces.js").Flow[], forEmpty: boolean): number {
  if (!forEmpty) return RETRY_SHORT_MS;
  // Find the minimum configured retryAfterMs across all candidate flows/states.
  let best: number | null = null;
  for (const flow of flows) {
    const flowDefault = flow.claimRetryAfterMs ?? null;
    // Check each state for a state-level override
    for (const state of flow.states) {
      if (state.promptTemplate === null) continue; // not a claimable state
      const ms = state.retryAfterMs ?? flowDefault;
      if (ms !== null && (best === null || ms < best)) best = ms;
    }
    // If no states had overrides but the flow has a default
    if (flowDefault !== null && (best === null || flowDefault < best)) best = flowDefault;
  }
  return best ?? RETRY_LONG_MS;
}

function noWorkResult(retryAfterMs: number, role: string): ReturnType<typeof jsonResult> {
  return jsonResult({
    next_action: "check_back",
    retry_after_ms: retryAfterMs,
    message: `No work available for role '${role}' right now. Call flow.claim again after the retry delay.`,
  });
}

export async function handleFlowClaim(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowClaimSchema, args);
  if (!v.ok) return v.result;
  const { worker_id, role, flow: flowName } = v.data;

  // 0. Reject drained workers immediately
  if (worker_id && deps.engine?.isDraining(worker_id)) {
    return noWorkResult(RETRY_SHORT_MS, role);
  }

  // 1. Find candidate flows filtered by discipline
  let candidateFlows: import("../../repositories/interfaces.js").Flow[] = [];

  if (flowName) {
    const flow = await deps.flows.getByName(flowName);
    if (!flow) return errorResult(`Flow not found: ${flowName}`);
    // Discipline must match — null discipline flows are claimable by any role
    if (flow.discipline !== null && flow.discipline !== role)
      return noWorkResult(flow.claimRetryAfterMs ?? RETRY_LONG_MS, role);
    // Paused flows have no claimable work
    if (flow.paused) return noWorkResult(flow.claimRetryAfterMs ?? RETRY_LONG_MS, role);
    candidateFlows = [flow];
  } else {
    const allFlows = await deps.flows.list();
    candidateFlows = allFlows.filter((f) => !f.paused && (f.discipline === null || f.discipline === role));
  }

  if (candidateFlows.length === 0) return noWorkResult(RETRY_LONG_MS, role); // no flows configured for this role

  // 2. Gather all unclaimed invocations across matching flows
  type CandidateInvocation = import("../../repositories/interfaces.js").Invocation;
  const allCandidates: CandidateInvocation[] = [];
  for (const flow of candidateFlows) {
    const unclaimed = await deps.invocations.findUnclaimedByFlow(flow.id);
    allCandidates.push(...unclaimed);
  }

  if (allCandidates.length === 0) {
    // Determine if entities exist but are all claimed (short retry) vs empty backlog (long retry).
    // Use hasAnyInFlowAndState (SELECT 1 LIMIT 1) to avoid loading full entity rows across all states.
    let hasEntities = false;
    for (const flow of candidateFlows) {
      const stateNames = flow.states.filter((s) => s.promptTemplate !== null).map((s) => s.name);
      if (await deps.entities.hasAnyInFlowAndState(flow.id, stateNames)) {
        hasEntities = true;
        break;
      }
    }
    return noWorkResult(resolveRetryMs(candidateFlows, !hasEntities), role);
  }

  // 3. Load entities for priority sorting
  const entityMap = new Map<string, import("../../repositories/interfaces.js").Entity>();
  const uniqueEntityIds = [...new Set(allCandidates.map((inv) => inv.entityId))];
  await Promise.all(
    uniqueEntityIds.map(async (eid) => {
      const entity = await deps.entities.get(eid);
      if (entity) entityMap.set(eid, entity);
    }),
  );

  // 4. Build a flow lookup map (needed for affinity window below)
  const flowById = new Map(candidateFlows.map((f) => [f.id, f]));

  // 5. Check affinity for each entity using findUnclaimedWithAffinity per flow
  const affinitySet = new Set<string>();
  if (worker_id) {
    await Promise.all(
      candidateFlows.map(async (flow) => {
        const affinityInvocations = await deps.invocations.findUnclaimedWithAffinity(flow.id, role, worker_id);
        for (const inv of affinityInvocations) {
          affinitySet.add(inv.entityId);
        }
      }),
    );
  }

  // 6. Sort candidates by priority algorithm
  const now = Date.now();
  allCandidates.sort((a, b) => {
    const entityA = entityMap.get(a.entityId);
    const entityB = entityMap.get(b.entityId);

    // Tier 1: Affinity (has affinity sorts first)
    const affinityA = affinitySet.has(a.entityId) ? 1 : 0;
    const affinityB = affinitySet.has(b.entityId) ? 1 : 0;
    if (affinityA !== affinityB) return affinityB - affinityA;

    // Tier 2: Entity priority (higher priority sorts first)
    const priA = entityA?.priority ?? 0;
    const priB = entityB?.priority ?? 0;
    if (priA !== priB) return priB - priA;

    // Tier 3: Time in state (longest waiting sorts first — earlier createdAt as stable proxy)
    const timeA = entityA?.createdAt?.getTime() ?? now;
    const timeB = entityB?.createdAt?.getTime() ?? now;
    return timeA - timeB;
  });

  // 7. Try claiming in priority order (handle race conditions)
  const claimerId = worker_id ?? `agent:${role}`;
  for (const invocation of allCandidates) {
    const entity = entityMap.get(invocation.entityId);

    // Finding 3: If entity is not in the entityMap, the invocation is orphaned.
    // Skip it — do not claim it, as that would permanently lock it.
    if (!entity) {
      continue;
    }

    // Claim entity first to establish ownership, then claim the invocation.
    // If invocation claim loses a race (returns null), release the entity so
    // another worker can pick it up.
    let claimedEntity: Awaited<ReturnType<typeof deps.entities.claimById>> = null;
    try {
      claimedEntity = await deps.entities.claimById(entity.id, claimerId);
    } catch (err) {
      console.error(`Failed to claim entity ${entity.id}:`, err);
      continue;
    }
    if (!claimedEntity) {
      // Another worker claimed this entity first — skip.
      continue;
    }

    // Finding 1: Verify entity state still matches invocation stage after claiming.
    // A race can leave stale invocation data if the entity changed state between
    // the invocation query and the entity claim.
    if (claimedEntity.state !== invocation.stage) {
      await deps.entities.release(entity.id, claimerId).catch(() => {});
      return noWorkResult(RETRY_SHORT_MS, role);
    }

    let claimed: Awaited<ReturnType<typeof deps.invocations.claim>>;
    try {
      claimed = await deps.invocations.claim(invocation.id, claimerId);
    } catch (err) {
      console.error(`Failed to claim invocation ${invocation.id}:`, err);
      if (entity && claimedEntity) {
        await deps.entities.release(entity.id, claimerId).catch(() => {});
      }
      continue;
    }
    if (!claimed) {
      // Race condition: invocation already claimed by another worker.
      // Release the entity so another worker can pick it up.
      if (entity && claimedEntity) {
        await deps.entities.release(entity.id, claimerId).catch(() => {});
      }
      continue;
    }
    const flow = entity ? flowById.get(entity.flowId) : undefined;
    if (!flow) {
      await deps.entities.release(entity.id, claimerId).catch(() => {});
      await deps.invocations
        .fail(claimed.id, `Flow not found for entity ${entity.id} (flowId: ${entity.flowId})`)
        .catch(() => {});
      continue;
    }
    // Record affinity for the claiming worker (best-effort; failure must not block the claim)
    if (worker_id && entity) {
      try {
        const windowMs = flow.affinityWindowMs ?? 300000;
        await deps.entities.setAffinity(claimed.entityId, worker_id, role, new Date(Date.now() + windowMs));
      } catch (err) {
        console.error(`Failed to set affinity for entity ${claimed.entityId}:`, err);
      }
    }
    // Finding 2: Emit entity.claimed event for WebSocket broadcast.
    if (deps.engine) {
      deps.engine
        .emit({
          type: "entity.claimed",
          entityId: entity.id,
          flowId: entity.flowId,
          agentId: claimerId,
          emittedAt: new Date(),
        })
        .catch((err: unknown) => {
          console.error(`Failed to emit entity.claimed for entity ${entity.id}:`, err);
        });
    }

    return jsonResult({
      entity_id: entity.id,
      invocation_id: claimed.id,
      flow: flow.name,
      state: claimed.stage,
      refs: claimedEntity.refs ?? null,
      artifacts: claimedEntity.artifacts ?? null,
    });
  }

  return noWorkResult(RETRY_SHORT_MS, role);
}

export async function handleFlowGetPrompt(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowGetPromptSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId } = v.data;

  const entity = await deps.entities.get(entityId);
  if (!entity) return errorResult(`Entity not found: ${entityId}`);

  const invocationList = await deps.invocations.findByEntity(entityId);
  if (invocationList.length === 0) {
    return errorResult(`No invocations found for entity: ${entityId}`);
  }

  // Return the active (claimed, not completed) invocation rather than the last by insertion order
  const active =
    invocationList.find((inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null) ??
    invocationList[invocationList.length - 1];

  return jsonResult({
    prompt: active.prompt,
    context: active.context,
  });
}

export async function handleFlowReport(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowReportSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId, signal, artifacts, worker_id } = v.data;

  const invocationList = await deps.invocations.findByEntity(entityId);
  const activeInvocation = invocationList.find(
    (inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null,
  );
  if (!activeInvocation) {
    return errorResult(`No active invocation found for entity: ${entityId}`);
  }

  if (!deps.engine) {
    return errorResult("Engine not available — MCP server started without engine dependency");
  }

  // Complete the current invocation BEFORE calling processSignal so the
  // concurrency check inside the engine doesn't count it as still-active.
  await deps.invocations.complete(activeInvocation.id, signal, artifacts);

  // Delegate to the engine — it handles gate evaluation, transition, event
  // emission, invocation creation, concurrency checks, and spawn logic.
  let result: Awaited<ReturnType<typeof deps.engine.processSignal>>;
  try {
    result = await deps.engine.processSignal(entityId, signal, artifacts, activeInvocation.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // processSignal failed after we already completed the invocation.
    // Only recreate the replacement if the engine did NOT already advance the entity
    // (i.e. the entity is still in the same state as when we started). If the engine
    // mutated the entity mid-execution and then threw, recreating the old invocation
    // would regress the entity back to a stale state.
    const entityAfter = await deps.entities.get(entityId).catch(() => null);
    if (!entityAfter || entityAfter.state === activeInvocation.stage) {
      await deps.invocations.create(
        entityId,
        activeInvocation.stage,
        activeInvocation.prompt,
        activeInvocation.mode,
        undefined,
        activeInvocation.context ?? undefined,
        activeInvocation.agentRole,
      );
    }
    return errorResult(message);
  }

  // Set affinity on completion for passive-mode invocations, after processSignal succeeds
  if (worker_id && activeInvocation.mode === "passive") {
    try {
      const entity = await deps.entities.get(entityId);
      if (entity) {
        const flow = await deps.flows.get(entity.flowId);
        const windowMs = flow?.affinityWindowMs ?? 300000;
        const affinityRole = flow?.discipline;
        if (affinityRole) {
          await deps.entities.setAffinity(entityId, worker_id, affinityRole, new Date(Date.now() + windowMs));
        }
      }
    } catch (err) {
      console.error(`Failed to set affinity for entity ${entityId} worker ${worker_id}:`, err);
    }
  }

  // Gate blocked — create a replacement invocation so the entity can be reclaimed.
  // Claim it immediately for the same worker so that a retry flow.report call (for
  // check_back) finds an active invocation without requiring a round-trip through
  // flow.claim. Workers on the "waiting" path will re-claim via flow.claim as usual.
  if (result.gated) {
    const replacement = await deps.invocations.create(
      entityId,
      activeInvocation.stage,
      activeInvocation.prompt,
      activeInvocation.mode,
      undefined,
      activeInvocation.context ?? undefined,
      activeInvocation.agentRole,
    );
    const claimedBy = activeInvocation.claimedBy;
    if (claimedBy) {
      await deps.invocations.claim(replacement.id, claimedBy).catch(() => {
        // Best-effort: if claim fails the invocation remains unclaimed and the worker
        // can re-claim it via flow.claim on the next attempt.
      });
    }

    if (result.gateTimedOut) {
      const renderedPrompt = result.timeoutPrompt ?? DEFAULT_TIMEOUT_PROMPT;
      return jsonResult({
        next_action: "check_back",
        message: renderedPrompt,
        retry_after_ms: 30000,
        timeout_prompt: renderedPrompt,
      });
    }

    return jsonResult({
      new_state: null,
      gated: true,
      gate_output: result.gateOutput,
      gateName: result.gateName,
      next_action: "waiting",
      failure_prompt: result.failurePrompt ?? null,
    });
  }

  // If the engine created a next invocation, fetch its prompt
  let nextPrompt: string | null = null;
  let nextContext: Record<string, unknown> | null = null;
  if (result.invocationId) {
    const nextInvocation = await deps.invocations.get(result.invocationId);
    if (nextInvocation) {
      nextPrompt = nextInvocation.prompt;
      nextContext = nextInvocation.context;
    }
  }

  const nextAction = result.terminal ? "completed" : result.invocationId ? "continue" : "waiting";

  return jsonResult({
    new_state: result.newState,
    gates_passed: result.gatesPassed,
    next_action: nextAction,
    prompt: nextPrompt,
    context: nextContext,
  });
}

export async function handleFlowFail(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowFailSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId, error } = v.data;

  const invocationList = await deps.invocations.findByEntity(entityId);
  const activeInvocation = invocationList.find(
    (inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null,
  );

  if (!activeInvocation) {
    return errorResult(`No active invocation found for entity: ${entityId}`);
  }

  await deps.invocations.fail(activeInvocation.id, error);

  return jsonResult({ acknowledged: true });
}
