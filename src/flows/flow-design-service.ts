/**
 * Flow Design Service — AI designs a custom flow for a repo.
 *
 * Takes the RepoConfig from interrogation + the engineering flow template,
 * dispatches to a runner, and produces a custom flow definition. The result
 * can be provisioned into the flow engine.
 */

import type { IFleetManager, ProvisionConfig } from "../fleet/provision-holyshipper.js";
import { logger } from "../logger.js";
import type {
  CreateFlowInput,
  CreateGateInput,
  CreateStateInput,
  CreateTransitionInput,
} from "../repositories/interfaces.js";
import { type FlowDesignResult, parseFlowDesignOutput, renderFlowDesignPrompt } from "./flow-design-prompt.js";
import type { InterrogationService } from "./interrogation-service.js";

export interface FlowDesignServiceConfig {
  interrogationService: InterrogationService;
  fleetManager: IFleetManager;
  getGithubToken: () => Promise<string | null>;
  tenantId: string;
  dispatchTimeoutMs?: number;
}

export interface DesignedFlow {
  flow: CreateFlowInput;
  states: CreateStateInput[];
  gates: CreateGateInput[];
  transitions: CreateTransitionInput[];
  gateWiring: Record<string, { fromState: string; trigger: string }>;
  notes: string;
}

export class FlowDesignService {
  private readonly interrogationService: InterrogationService;
  private readonly fleetManager: IFleetManager;
  private readonly getGithubToken: () => Promise<string | null>;
  private readonly dispatchTimeoutMs: number;

  constructor(config: FlowDesignServiceConfig) {
    this.interrogationService = config.interrogationService;
    this.fleetManager = config.fleetManager;
    this.getGithubToken = config.getGithubToken;
    this.dispatchTimeoutMs = config.dispatchTimeoutMs ?? 600_000;
  }

  /**
   * Design a custom flow for a repo based on its interrogation config.
   */
  async designFlow(repoFullName: string): Promise<DesignedFlow> {
    const tag = "[flow-design]";

    // Get repo config from interrogation
    const configResult = await this.interrogationService.getConfig(repoFullName);
    if (!configResult) {
      throw new Error(`No repo config found for ${repoFullName}. Run interrogation first.`);
    }

    const [owner = "", repo = ""] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repo name: ${repoFullName}`);
    }

    // Render prompt
    const prompt = renderFlowDesignPrompt(repoFullName, configResult.config);

    // Get GitHub token
    let githubToken = "";
    try {
      githubToken = (await this.getGithubToken()) ?? "";
    } catch (err) {
      logger.warn(`${tag} github token failed`, { error: String(err) });
    }

    // Provision runner
    const entityId = `flow-design-${crypto.randomUUID()}`;
    const provisionConfig: ProvisionConfig = {
      entityId,
      flowName: "flow-design",
      owner,
      repo,
      issueNumber: 0,
      githubToken,
    };

    logger.info(`${tag} provisioning runner`, { repo: repoFullName });
    const { containerId, runnerUrl } = await this.fleetManager.provision(entityId, provisionConfig);

    try {
      // Dispatch prompt
      logger.info(`${tag} dispatching`, { repo: repoFullName, promptLength: prompt.length });
      const res = await fetch(`${runnerUrl.replace(/\/$/, "")}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, modelTier: "sonnet" }),
        signal: AbortSignal.timeout(this.dispatchTimeoutMs),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Dispatch failed: HTTP ${res.status} — ${text.slice(0, 500)}`);
      }

      // Parse SSE response
      const body = await res.text();
      const rawOutput = this.extractOutputFromSSE(body);

      logger.info(`${tag} parsing output`, { repo: repoFullName, outputLength: rawOutput.length });
      const result = parseFlowDesignOutput(rawOutput);

      logger.info(`${tag} complete`, {
        repo: repoFullName,
        stateCount: result.design.states.length,
        gateCount: result.design.gates.length,
        transitionCount: result.design.transitions.length,
        notes: result.notes,
      });

      return this.toDesignedFlow(result);
    } finally {
      logger.info(`${tag} tearing down runner`, { containerId: containerId.slice(0, 12) });
      try {
        await this.fleetManager.teardown(containerId);
      } catch (err) {
        logger.warn(`${tag} teardown failed`, { error: String(err) });
      }
    }
  }

  /**
   * Convert parsed FlowDesignResult into Create*Input shapes
   * ready for the flow provisioner.
   */
  private toDesignedFlow(result: FlowDesignResult): DesignedFlow {
    const { design, notes } = result;

    const flow: CreateFlowInput = {
      name: design.flow.name,
      description: design.flow.description,
      initialState: design.flow.initialState,
      maxConcurrent: design.flow.maxConcurrent,
      maxConcurrentPerRepo: design.flow.maxConcurrentPerRepo,
      affinityWindowMs: design.flow.affinityWindowMs,
      claimRetryAfterMs: design.flow.claimRetryAfterMs,
      gateTimeoutMs: design.flow.gateTimeoutMs,
      defaultModelTier: design.flow.defaultModelTier,
      maxInvocationsPerEntity: design.flow.maxInvocationsPerEntity,
      discipline: "engineering",
    };

    const states: CreateStateInput[] = design.states.map((s) => ({
      name: s.name,
      agentRole: s.agentRole,
      modelTier: s.modelTier,
      mode: s.mode as CreateStateInput["mode"],
      promptTemplate: s.promptTemplate,
    }));

    const gates: CreateGateInput[] = design.gates.map((g) => ({
      name: g.name,
      type: g.type,
      primitiveOp: g.primitiveOp,
      primitiveParams: g.primitiveParams,
      timeoutMs: g.timeoutMs,
      failurePrompt: g.failurePrompt,
      timeoutPrompt: g.timeoutPrompt,
      outcomes: g.outcomes,
    }));

    const transitions: CreateTransitionInput[] = design.transitions.map((t) => ({
      fromState: t.fromState,
      toState: t.toState,
      trigger: t.trigger,
      priority: t.priority ?? 0,
    }));

    return { flow, states, gates, transitions, gateWiring: design.gateWiring, notes };
  }

  private extractOutputFromSSE(body: string): string {
    const sseEvents = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => {
        try {
          return JSON.parse(line.slice(5)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    const resultEvent = sseEvents.find((e) => e.type === "result");
    if (resultEvent) {
      const artifacts = resultEvent.artifacts as Record<string, unknown> | undefined;
      if (artifacts?.output && typeof artifacts.output === "string") return artifacts.output;
      if (resultEvent.text && typeof resultEvent.text === "string") return resultEvent.text;
    }

    const textParts: string[] = [];
    for (const event of sseEvents) {
      if (event.type === "content" || event.type === "text") {
        const text = (event.text ?? event.content ?? "") as string;
        if (text) textParts.push(text);
      }
    }

    if (textParts.length > 0) return textParts.join("");
    throw new Error("No usable output found in SSE stream");
  }
}
