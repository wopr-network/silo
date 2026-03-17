/**
 * Flow Edit Service — AI edits an existing flow via natural language.
 *
 * Provisions a runner, dispatches the flow-edit prompt, parses the structured
 * output, and returns the updated YAML with explanation and diff.
 */

import type { IFleetManager, ProvisionConfig } from "../fleet/provision-holyshipper.js";
import { logger } from "../logger.js";
import { type FlowEditResult, parseFlowEditOutput, renderFlowEditPrompt } from "./flow-edit-prompt.js";

export interface FlowEditServiceConfig {
  fleetManager: IFleetManager;
  getGithubToken: () => Promise<string | null>;
  /** Dispatch timeout in ms. Default 600_000 (10 min). */
  dispatchTimeoutMs?: number;
}

export class FlowEditService {
  private readonly fleetManager: IFleetManager;
  private readonly getGithubToken: () => Promise<string | null>;
  private readonly dispatchTimeoutMs: number;

  constructor(config: FlowEditServiceConfig) {
    this.fleetManager = config.fleetManager;
    this.getGithubToken = config.getGithubToken;
    this.dispatchTimeoutMs = config.dispatchTimeoutMs ?? 600_000;
  }

  /**
   * Edit a flow via natural language. Provisions a runner, dispatches the
   * flow-edit prompt, and returns the updated YAML with explanation and diff.
   */
  async editFlow(repoFullName: string, message: string, currentYaml: string): Promise<FlowEditResult> {
    const tag = "[flow-edit]";
    logger.info(`${tag} starting`, { repo: repoFullName });

    const [owner = "", repo = ""] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repo name: ${repoFullName}. Expected "owner/repo".`);
    }

    const prompt = renderFlowEditPrompt(currentYaml, message);

    let githubToken = "";
    try {
      githubToken = (await this.getGithubToken()) ?? "";
    } catch (err) {
      logger.warn(`${tag} github token failed`, { error: String(err) });
    }

    const entityId = `flow-edit-${crypto.randomUUID()}`;
    const provisionConfig: ProvisionConfig = {
      entityId,
      flowName: "flow-edit",
      owner,
      repo,
      issueNumber: 0,
      githubToken,
    };

    logger.info(`${tag} provisioning runner`, { repo: repoFullName });
    const { containerId, runnerUrl } = await this.fleetManager.provision(entityId, provisionConfig);

    try {
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

      const body = await res.text();
      const rawOutput = this.extractOutputFromSSE(body);

      logger.info(`${tag} parsing output`, { repo: repoFullName, outputLength: rawOutput.length });
      const result = parseFlowEditOutput(rawOutput);

      logger.info(`${tag} complete`, { repo: repoFullName, diffCount: result.diff.length });
      return result;
    } finally {
      logger.info(`${tag} tearing down runner`, { containerId: containerId.slice(0, 12) });
      try {
        await this.fleetManager.teardown(containerId);
      } catch (err) {
        logger.warn(`${tag} teardown failed`, { error: String(err) });
      }
    }
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
