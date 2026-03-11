/**
 * DirectFlowEngine — in-process implementation of IFlowEngine.
 *
 * Wraps the Engine class + repos to provide claim/report without HTTP.
 * This is what the run-loop uses when engine and workers live in the same process.
 */
import type { ClaimResponse, ReportResponse } from "../api/wire-types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { IEntityRepository, IFlowRepository, IInvocationRepository } from "../repositories/interfaces.js";
import { DEFAULT_TIMEOUT_PROMPT } from "./constants.js";
import type { Engine } from "./engine.js";
import type { FlowEngineRequestOptions, IFlowEngine } from "./flow-engine-interface.js";

const RETRY_SHORT_MS = 30_000;
const RETRY_LONG_MS = 300_000;

function noWorkResponse(retryAfterMs: number, role: string): ClaimResponse {
  return {
    next_action: "check_back",
    retry_after_ms: retryAfterMs,
    message: `No work available for role '${role}' right now. Call flow.claim again after the retry delay.`,
  };
}

export interface DirectFlowEngineDeps {
  engine: Engine;
  entities: IEntityRepository;
  flows: IFlowRepository;
  invocations: IInvocationRepository;
  logger?: Logger;
}

export class DirectFlowEngine implements IFlowEngine {
  private engine: Engine;
  private entities: IEntityRepository;
  private flows: IFlowRepository;
  private invocations: IInvocationRepository;
  private logger: Logger;

  constructor(deps: DirectFlowEngineDeps) {
    this.engine = deps.engine;
    this.entities = deps.entities;
    this.flows = deps.flows;
    this.invocations = deps.invocations;
    this.logger = deps.logger ?? consoleLogger;
  }

  async claim(
    params: { workerId?: string; role: string; flow?: string },
    _opts?: FlowEngineRequestOptions,
  ): Promise<ClaimResponse> {
    const { workerId, role, flow } = params;

    const result = await this.engine.claimWork(role, flow, workerId);

    if (result === null) {
      // Empty backlog — find best retry delay from flow config
      const retryMs = await this.resolveRetryMs(role, flow, true);
      return noWorkResponse(retryMs, role);
    }

    if (result === "all_claimed") {
      return noWorkResponse(RETRY_SHORT_MS, role);
    }

    // Fetch the claimed invocation to get prompt + context
    const invocation = await this.invocations.get(result.invocationId);
    const prompt = invocation?.prompt ?? "";
    const context = invocation?.context ?? null;

    // Look up state config for modelTier and agentRole using the entity's
    // pinned flow version (not latest) so values match the prompt version.
    let model_tier: string | undefined;
    let agent_role: string | undefined;
    if (result.flowName && result.stage) {
      const entity = await this.entities.get(result.entityId);
      if (entity) {
        const flowDef = await this.flows.getAtVersion(entity.flowId, entity.flowVersion);
        if (flowDef) {
          const state = flowDef.states.find((s) => s.name === result.stage);
          if (state) {
            model_tier = state.modelTier ?? undefined;
            agent_role = state.agentRole ?? undefined;
          }
        }
      }
    }

    return {
      worker_id: workerId,
      entity_id: result.entityId,
      invocation_id: result.invocationId,
      flow: result.flowName,
      stage: result.stage,
      prompt,
      context,
      ...(model_tier ? { model_tier } : {}),
      ...(agent_role ? { agent_role } : {}),
    };
  }

  async report(
    params: {
      entityId: string;
      signal: string;
      artifacts?: Record<string, unknown>;
      workerId?: string;
    },
    _opts?: FlowEngineRequestOptions,
  ): Promise<ReportResponse> {
    const { entityId, signal, artifacts, workerId } = params;

    // 1. Find the active invocation
    const invocationList = await this.invocations.findByEntity(entityId);
    const activeInvocation = invocationList.find(
      (inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null,
    );
    if (!activeInvocation) {
      throw new Error(`No active invocation found for entity: ${entityId}`);
    }

    // 2. Complete the current invocation BEFORE processSignal so concurrency
    //    checks don't count it as still-active
    await this.invocations.complete(activeInvocation.id, signal, artifacts);

    // 3. Process the signal through the engine
    let result: Awaited<ReturnType<typeof this.engine.processSignal>>;
    try {
      result = await this.engine.processSignal(entityId, signal, artifacts, activeInvocation.id);
    } catch (err) {
      // processSignal failed after invocation completed — recreate replacement
      // if entity hasn't advanced past the current stage
      const entityAfter = await this.entities.get(entityId).catch(() => null);
      if (!entityAfter || entityAfter.state === activeInvocation.stage) {
        await this.invocations.create(
          entityId,
          activeInvocation.stage,
          activeInvocation.prompt,
          activeInvocation.mode,
          undefined,
          activeInvocation.context ?? undefined,
          activeInvocation.agentRole,
        );
      }
      throw err;
    }

    // 4. Set affinity on completion for passive-mode invocations
    if (workerId && activeInvocation.mode === "passive") {
      try {
        const entity = await this.entities.get(entityId);
        if (entity) {
          const flow = await this.flows.get(entity.flowId);
          const windowMs = flow?.affinityWindowMs ?? 300000;
          const affinityRole = flow?.discipline;
          if (affinityRole) {
            await this.entities.setAffinity(entityId, workerId, affinityRole, new Date(Date.now() + windowMs));
          }
        }
      } catch (err) {
        this.logger.warn(`[direct-engine] Failed to set affinity for entity ${entityId}:`, err);
      }
    }

    // 5. Handle gated results — create replacement invocation
    if (result.gated) {
      const replacement = await this.invocations.create(
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
        await this.invocations.claim(replacement.id, claimedBy).catch(() => {});
      }

      if (result.gateTimedOut) {
        const renderedPrompt = result.timeoutPrompt ?? DEFAULT_TIMEOUT_PROMPT;
        return {
          next_action: "check_back",
          message: renderedPrompt,
          retry_after_ms: 30000,
          timeout_prompt: renderedPrompt,
        };
      }

      return {
        next_action: "waiting",
        new_state: null,
        gated: true,
        gate_output: result.gateOutput ?? "",
        gateName: result.gateName ?? "",
        failure_prompt: result.failurePrompt ?? null,
      };
    }

    // 6. Fetch next invocation's prompt if engine created one
    let nextPrompt: string | null = null;
    let nextContext: Record<string, unknown> | null = null;
    if (result.invocationId) {
      const nextInvocation = await this.invocations.get(result.invocationId);
      if (nextInvocation) {
        nextPrompt = nextInvocation.prompt;
        nextContext = nextInvocation.context;
      }
    }

    const nextAction = result.terminal ? "completed" : result.invocationId ? "continue" : "waiting";

    if (nextAction === "completed") {
      return {
        next_action: "completed",
        new_state: result.newState ?? "",
        gates_passed: result.gatesPassed,
        prompt: null,
        context: null,
      };
    }

    if (nextAction === "continue") {
      // Auto-claim the next invocation for the same worker so the RunLoop
      // can report against it without a separate claim round-trip.
      // When workerId is absent, skip auto-claim and fall through to the
      // continue response — the caller will re-claim on its own.
      if (result.invocationId && workerId) {
        let claimed = false;
        try {
          const claimResult = await this.invocations.claim(result.invocationId, workerId);
          claimed = claimResult !== null;
        } catch (err) {
          this.logger.warn(`[direct-engine] auto-claim failed for invocation ${result.invocationId}`, err);
        }
        if (!claimed) {
          // Claim lost to a race — release the slot so the RunLoop exits its
          // inner loop and re-claims via claimWork, rather than looping on the
          // old prompt and hitting "no active invocation" on the next report.
          this.logger.warn(`[direct-engine] auto-claim race — releasing slot`, {
            entityId,
            invocationId: result.invocationId,
            newState: result.newState,
          });
          return {
            next_action: "completed",
            new_state: result.newState ?? "",
            gates_passed: result.gatesPassed,
            prompt: null,
            context: null,
          };
        }
      }

      // Look up model_tier and agent_role for the new state using the entity's
      // pinned flow version so values stay consistent with the prompt.
      let next_model_tier: string | undefined;
      let next_agent_role: string | undefined;
      if (result.newState) {
        const entity = await this.entities.get(entityId);
        if (entity) {
          const flow = await this.flows.getAtVersion(entity.flowId, entity.flowVersion);
          if (flow) {
            const newStateDef = flow.states.find((s) => s.name === result.newState);
            if (newStateDef) {
              next_model_tier = newStateDef.modelTier ?? undefined;
              next_agent_role = newStateDef.agentRole ?? undefined;
            } else {
              this.logger.warn(`[direct-engine] state "${result.newState}" not found in flow version`, {
                entityId,
                flowId: entity.flowId,
                flowVersion: entity.flowVersion,
              });
            }
          } else {
            this.logger.warn(`[direct-engine] flow version not found for model_tier lookup`, {
              entityId,
              flowId: entity.flowId,
              flowVersion: entity.flowVersion,
            });
          }
        } else {
          this.logger.warn(`[direct-engine] entity not found for model_tier lookup`, { entityId });
        }
      }
      return {
        next_action: "continue",
        new_state: result.newState ?? "",
        gates_passed: result.gatesPassed,
        prompt: nextPrompt,
        context: nextContext,
        ...(next_model_tier ? { model_tier: next_model_tier } : {}),
        ...(next_agent_role ? { agent_role: next_agent_role } : {}),
      };
    }

    // "waiting" — no next invocation, not terminal
    return {
      next_action: "completed",
      new_state: result.newState ?? "",
      gates_passed: result.gatesPassed,
      prompt: null,
      context: null,
    };
  }

  private async resolveRetryMs(role: string, flowName?: string, forEmpty = false): Promise<number> {
    if (!forEmpty) return RETRY_SHORT_MS;

    let flows: Awaited<ReturnType<typeof this.flows.listAll>>;
    if (flowName) {
      const flow = await this.flows.getByName(flowName);
      flows = flow ? [flow] : [];
    } else {
      const allFlows = await this.flows.listAll();
      flows = allFlows.filter((f) => !f.paused && (f.discipline === null || f.discipline === role));
    }

    let best: number | null = null;
    for (const flow of flows) {
      const flowDefault = flow.claimRetryAfterMs ?? null;
      for (const state of flow.states) {
        if (state.promptTemplate === null) continue;
        const ms = state.retryAfterMs ?? flowDefault;
        if (ms !== null && (best === null || ms < best)) best = ms;
      }
      if (flowDefault !== null && (best === null || flowDefault < best)) best = flowDefault;
    }
    return best ?? RETRY_LONG_MS;
  }
}
