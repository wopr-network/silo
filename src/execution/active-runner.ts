import type { IAIProviderAdapter } from "../adapters/interfaces.js";
import type { Engine } from "../engine/engine.js";
import type {
  IEntityRepository,
  IFlowRepository,
  IInvocationRepository,
  Invocation,
} from "../repositories/interfaces.js";

const MODEL_TIER_MAP: Record<string, string> = {
  reasoning: "claude-opus-4-6",
  execution: "claude-sonnet-4-6",
  monitoring: "claude-haiku-4-5",
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_POLL_INTERVAL_MS = 1000;

interface ParsedResponse {
  signal: string;
  artifacts: Record<string, unknown>;
}

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

      const processed = await this.pollOnce(flowId);

      if (once) break;
      if (!processed) {
        await sleep(pollIntervalMs, signal);
      }
    }
  }

  private async pollOnce(flowId?: string): Promise<boolean> {
    const candidates = await this.invocationRepo.findUnclaimedActive(flowId);
    if (candidates.length === 0) return false;

    for (const invocation of candidates) {
      const claimed = await this.invocationRepo.claim(invocation.id, "active-runner");
      if (!claimed) continue;

      await this.processInvocation(claimed);
      return true;
    }

    return false;
  }

  private async processInvocation(invocation: Invocation): Promise<void> {
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

    try {
      await this.engine.processSignal(invocation.entityId, parsed.signal, parsed.artifacts, invocation.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[active-runner] processSignal failed for entity ${invocation.entityId}:`, err);
      await this.invocationRepo.fail(invocation.id, message);
      return;
    }

    // NOTE: The invocation claim TTL (default 30 min) starts at claim time and covers both the
    // AI call and processSignal. If either takes longer than the TTL, the reaper may release the
    // claim and allow duplicate processing. No heartbeat/extendClaim mechanism exists yet.
    // Ensure claimTtl >= 2x the expected AI window when configuring invocations.
    try {
      await this.invocationRepo.complete(invocation.id, parsed.signal, parsed.artifacts);
    } catch (err) {
      // processSignal already succeeded and entity state has changed — log and continue.
      console.error(
        `[active-runner] complete() failed for invocation ${invocation.id} (signal already processed):`,
        err,
      );
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

  private parseResponse(content: string): ParsedResponse | null {
    const signalMatch = content.match(/^SIGNAL:\s*(.+)$/m);
    if (!signalMatch) return null;

    const signal = signalMatch[1].trim();

    let artifacts: Record<string, unknown> = {};
    const artifactsMatch = content.match(/^ARTIFACTS:\s*\n([\s\S]*)/m);
    if (artifactsMatch) {
      try {
        artifacts = JSON.parse(artifactsMatch[1].trim());
      } catch {
        // Invalid JSON in artifacts — use empty object
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
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
