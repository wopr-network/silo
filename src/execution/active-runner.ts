import type { Engine, ProcessSignalResult } from "../engine/engine.js";
import type {
  IEntityRepository,
  IFlowRepository,
  IInvocationRepository,
  Invocation,
} from "../repositories/interfaces.js";

/** Adapter for AI model providers (Anthropic, OpenAI, etc.). */
export interface IAIProviderAdapter {
  /** Send a prompt to an AI model and return the response content. */
  invoke(prompt: string, config: { model: string }): Promise<{ content: string }>;
}

const MODEL_TIER_MAP: Record<string, string> = {
  reasoning: "claude-opus-4-6",
  execution: "claude-sonnet-4-6",
  monitoring: "claude-haiku-4-5",
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_POLL_INTERVAL_MS = 1000;

export interface ActiveRunnerDeps {
  engine: Engine;
  aiAdapter: IAIProviderAdapter;
  invocationRepo: IInvocationRepository;
  entityRepo: IEntityRepository;
  flowRepo: IFlowRepository;
}

export interface ActiveRunnerRunOptions {
  pollIntervalMs?: number;
  once?: boolean;
  flowName?: string;
  signal?: AbortSignal;
}

export class ActiveRunner {
  private engine: Engine;
  private aiAdapter: IAIProviderAdapter;
  private invocationRepo: IInvocationRepository;
  private entityRepo: IEntityRepository;
  private flowRepo: IFlowRepository;

  constructor(deps: ActiveRunnerDeps) {
    this.engine = deps.engine;
    this.aiAdapter = deps.aiAdapter;
    this.invocationRepo = deps.invocationRepo;
    this.entityRepo = deps.entityRepo;
    this.flowRepo = deps.flowRepo;
  }

  async run(options: ActiveRunnerRunOptions = {}): Promise<void> {
    const { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, once = false, flowName, signal } = options;
    let flowId: string | undefined;
    if (flowName) {
      const flow = await this.flowRepo.getByName(flowName);
      if (!flow) throw new Error(`Flow "${flowName}" not found`);
      flowId = flow.id;
    }
    while (true) {
      if (signal?.aborted) break;
      const processed = await this.pollOnce(flowId, signal);
      if (once) break;
      if (!processed) {
        await sleep(pollIntervalMs, signal);
      }
    }
  }

  private async pollOnce(flowId?: string, signal?: AbortSignal): Promise<boolean> {
    const candidates = await this.invocationRepo.findUnclaimedActive(flowId);
    if (candidates.length === 0) return false;
    for (const invocation of candidates) {
      const claimed = await this.invocationRepo.claim(invocation.id, "active-runner");
      if (!claimed) continue;
      await this.processInvocation(claimed, signal);
      return true;
    }
    return false;
  }

  private async processInvocation(invocation: Invocation, signal?: AbortSignal): Promise<void> {
    const model = await this.resolveModel(invocation);
    let content: string;
    try {
      const response = await this.aiAdapter.invoke(invocation.prompt, { model });
      content = response.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.invocationRepo.fail(invocation.id, message);
      return;
    }

    const parsed = this.parseResponse(content);
    if (!parsed) {
      await this.invocationRepo.fail(invocation.id, "No SIGNAL found in AI response");
      return;
    }

    // Complete the current invocation BEFORE calling processSignal so the
    // concurrency check inside the engine doesn't count it as still-active.
    try {
      await this.invocationRepo.complete(invocation.id, parsed.signal, parsed.artifacts);
    } catch (err) {
      console.error(`[active-runner] complete() failed for invocation ${invocation.id} before processSignal:`, err);
      return;
    }

    const MAX_PROCESS_SIGNAL_RETRIES = 3;

    let result: ProcessSignalResult;
    try {
      result = await this.engine.processSignal(invocation.entityId, parsed.signal, parsed.artifacts, invocation.id);
    } catch (err) {
      console.error(`[active-runner] processSignal failed for entity ${invocation.entityId}:`, err);
      // processSignal failed after we already completed the invocation. Track retry count
      // via context to prevent infinite re-queue loops on persistent errors.
      const retryCount = (invocation.context?.retryCount as number | undefined) ?? 0;
      if (retryCount >= MAX_PROCESS_SIGNAL_RETRIES) {
        console.error(
          `[active-runner] entity ${invocation.entityId} exceeded max processSignal retries (${MAX_PROCESS_SIGNAL_RETRIES}), marking as stuck`,
        );
        await this.entityRepo.updateArtifacts(invocation.entityId, { stuck: true, stuckAt: new Date().toISOString() });
        return;
      }
      await this.invocationRepo.create(
        invocation.entityId,
        invocation.stage,
        invocation.prompt,
        invocation.mode,
        undefined,
        { ...(invocation.context ?? {}), retryCount: retryCount + 1 },
      );
      return;
    }

    // Gate timed out — re-queue after backoff instead of failing.
    // Create a replacement unclaimed invocation so the entity can be reclaimed
    // on the next poll cycle after the backoff wait.
    if (result.gated && result.gateTimedOut) {
      const retryAfterMs = 30000;
      console.info(
        `[active-runner] gate timed out for entity ${invocation.entityId}, re-queuing after ${retryAfterMs}ms`,
      );
      await this.invocationRepo.create(
        invocation.entityId,
        invocation.stage,
        invocation.prompt,
        invocation.mode,
        undefined,
        invocation.context ?? undefined,
      );
      await sleep(retryAfterMs, signal);
      return;
    }
  }

  private async resolveModel(invocation: Invocation): Promise<string> {
    const entity = await this.entityRepo.get(invocation.entityId);
    if (!entity) return DEFAULT_MODEL;
    const flow = await this.flowRepo.get(entity.flowId);
    if (!flow) return DEFAULT_MODEL;
    const state = flow.states.find((s) => s.name === invocation.stage);
    if (!state?.modelTier) return DEFAULT_MODEL;
    return MODEL_TIER_MAP[state.modelTier] ?? DEFAULT_MODEL;
  }

  parseResponse(content: string): { signal: string; artifacts: Record<string, unknown> } | null {
    const signalMatch = content.match(/^SIGNAL:\s*(.+)$/m);
    if (!signalMatch) return null;
    const signal = signalMatch[1].trim();
    let artifacts: Record<string, unknown> = {};
    const artifactsMatch = content.match(/^ARTIFACTS:\s*\n([\s\S]*)/m);
    if (artifactsMatch) {
      try {
        artifacts = JSON.parse(artifactsMatch[1].trim());
      } catch {
        console.warn(
          "[active-runner] Failed to parse ARTIFACTS JSON, using empty object. Raw content:",
          artifactsMatch[1].trim(),
        );
      }
    }
    return { signal, artifacts };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
