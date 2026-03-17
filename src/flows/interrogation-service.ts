/**
 * Interrogation Service — one-shot dispatch that inspects a repo.
 *
 * This is NOT a flow. It provisions a runner, dispatches the interrogation
 * prompt, parses the structured output, and stores RepoConfig + gaps in the DB.
 * Runs before any flow exists for a repo.
 */

import { and, eq } from "drizzle-orm";
import type { IFleetManager, ProvisionConfig } from "../fleet/provision-holyshipper.js";
import { logger } from "../logger.js";
import { repoConfigs, repoGaps } from "../repositories/drizzle/schema.js";
import {
  type Gap,
  INTERROGATION_PROMPT,
  type InterrogationResult,
  parseInterrogationOutput,
  type RepoConfig,
} from "./interrogation-prompt.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
type Db = any;

export interface InterrogationServiceConfig {
  db: Db;
  tenantId: string;
  fleetManager: IFleetManager;
  getGithubToken: () => Promise<string | null>;
  /** Dispatch timeout in ms. Default 600_000 (10 min). */
  dispatchTimeoutMs?: number;
}

export interface InterrogationServiceResult {
  repoConfigId: string;
  config: RepoConfig;
  gaps: Gap[];
  knowledgeMd: string | null;
}

export class InterrogationService {
  private readonly db: Db;
  private readonly tenantId: string;
  private readonly fleetManager: IFleetManager;
  private readonly getGithubToken: () => Promise<string | null>;
  private readonly dispatchTimeoutMs: number;

  constructor(config: InterrogationServiceConfig) {
    this.db = config.db;
    this.tenantId = config.tenantId;
    this.fleetManager = config.fleetManager;
    this.getGithubToken = config.getGithubToken;
    this.dispatchTimeoutMs = config.dispatchTimeoutMs ?? 600_000;
  }

  /**
   * Run interrogation on a repo. Provisions a runner, dispatches the prompt,
   * parses the result, and stores RepoConfig + gaps in the DB.
   */
  async interrogate(repoFullName: string): Promise<InterrogationServiceResult> {
    const tag = "[interrogation]";
    logger.info(`${tag} starting`, { repo: repoFullName, tenantId: this.tenantId });

    const [owner = "", repo = ""] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repo name: ${repoFullName}. Expected "owner/repo".`);
    }

    // Render prompt
    const prompt = INTERROGATION_PROMPT.replace("{{repoFullName}}", repoFullName);

    // Get GitHub token
    let githubToken = "";
    try {
      githubToken = (await this.getGithubToken()) ?? "";
    } catch (err) {
      logger.warn(`${tag} github token failed`, { error: String(err) });
    }

    // Provision runner
    const entityId = `interrogation-${crypto.randomUUID()}`;
    const provisionConfig: ProvisionConfig = {
      entityId,
      flowName: "interrogation",
      owner,
      repo,
      issueNumber: 0,
      githubToken,
    };

    logger.info(`${tag} provisioning runner`, { repo: repoFullName, entityId });
    const { containerId, runnerUrl } = await this.fleetManager.provision(entityId, provisionConfig);

    try {
      // Dispatch prompt
      logger.info(`${tag} dispatching`, { repo: repoFullName, runnerUrl, promptLength: prompt.length });
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
      const result = parseInterrogationOutput(rawOutput);

      // Store in DB
      const repoConfigId = await this.storeResult(repoFullName, result);

      logger.info(`${tag} complete`, {
        repo: repoFullName,
        gapCount: result.gaps.length,
        hasKnowledgeMd: result.knowledgeMd !== null,
      });

      return {
        repoConfigId,
        config: result.config,
        gaps: result.gaps,
        knowledgeMd: result.knowledgeMd,
      };
    } finally {
      // Always teardown
      logger.info(`${tag} tearing down runner`, { containerId: containerId.slice(0, 12) });
      try {
        await this.fleetManager.teardown(containerId);
      } catch (err) {
        logger.warn(`${tag} teardown failed`, { error: String(err) });
      }
    }
  }

  /**
   * Extract the AI's text output from SSE event stream.
   * Looks for result event and concatenates text content.
   */
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

    // The result event contains the full output in artifacts.output or as text
    const resultEvent = sseEvents.find((e) => e.type === "result");
    if (resultEvent) {
      // Try artifacts.output first (structured), then text field
      const artifacts = resultEvent.artifacts as Record<string, unknown> | undefined;
      if (artifacts?.output && typeof artifacts.output === "string") {
        return artifacts.output;
      }
      if (resultEvent.text && typeof resultEvent.text === "string") {
        return resultEvent.text;
      }
    }

    // Fallback: concatenate all text/content events
    const textParts: string[] = [];
    for (const event of sseEvents) {
      if (event.type === "content" || event.type === "text") {
        const text = (event.text ?? event.content ?? "") as string;
        if (text) textParts.push(text);
      }
    }

    if (textParts.length > 0) {
      return textParts.join("");
    }

    throw new Error("No usable output found in SSE stream");
  }

  /**
   * Store interrogation result in DB. Atomic upsert via ON CONFLICT to avoid
   * race conditions when concurrent interrogations target the same repo.
   */
  private async storeResult(repoFullName: string, result: InterrogationResult): Promise<string> {
    const repoConfigId = crypto.randomUUID();
    const now = new Date();

    // Atomic upsert — ON CONFLICT on (tenant_id, repo) unique index
    const rows = await this.db
      .insert(repoConfigs)
      .values({
        id: repoConfigId,
        tenantId: this.tenantId,
        repo: repoFullName,
        config: result.config,
        claudeMd: result.knowledgeMd,
        status: "complete",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [repoConfigs.tenantId, repoConfigs.repo],
        set: {
          config: result.config,
          claudeMd: result.knowledgeMd,
          status: "complete",
          updatedAt: now,
        },
      })
      .returning({ id: repoConfigs.id });

    const finalId = (rows[0]?.id as string) ?? repoConfigId;

    // Delete old gaps and insert fresh ones
    await this.db.delete(repoGaps).where(eq(repoGaps.repoConfigId, finalId));

    if (result.gaps.length > 0) {
      await this.db.insert(repoGaps).values(
        result.gaps.map((gap) => ({
          id: crypto.randomUUID(),
          tenantId: this.tenantId,
          repoConfigId: finalId,
          capability: gap.capability,
          title: gap.title,
          priority: gap.priority,
          description: gap.description,
          status: "open",
          createdAt: now,
        })),
      );
    }

    return finalId;
  }

  /**
   * Get stored repo config for a repo.
   */
  async getConfig(
    repoFullName: string,
  ): Promise<{ id: string; config: RepoConfig; knowledgeMd: string | null } | null> {
    const rows = await this.db
      .select({
        id: repoConfigs.id,
        config: repoConfigs.config,
        knowledgeMd: repoConfigs.claudeMd,
      })
      .from(repoConfigs)
      .where(and(eq(repoConfigs.tenantId, this.tenantId), eq(repoConfigs.repo, repoFullName)))
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0] as { id: string; config: RepoConfig; knowledgeMd: string | null };
  }

  /**
   * Get gaps for a repo.
   */
  async getGaps(repoFullName: string): Promise<Array<Gap & { id: string; status: string; issueUrl: string | null }>> {
    const config = await this.getConfig(repoFullName);
    if (!config) return [];

    const rows = await this.db
      .select({
        id: repoGaps.id,
        capability: repoGaps.capability,
        title: repoGaps.title,
        priority: repoGaps.priority,
        description: repoGaps.description,
        status: repoGaps.status,
        issueUrl: repoGaps.issueUrl,
      })
      .from(repoGaps)
      .where(eq(repoGaps.repoConfigId, config.id));

    return rows as Array<Gap & { id: string; status: string; issueUrl: string | null }>;
  }

  /**
   * Mark a gap as having an issue created.
   * Validates the gap belongs to the specified repo to prevent cross-repo linking.
   */
  async linkGapToIssue(gapId: string, repoFullName: string, issueUrl: string): Promise<void> {
    // Verify gap belongs to the correct repo
    const config = await this.getConfig(repoFullName);
    if (!config) {
      throw new Error(`No config found for repo ${repoFullName}`);
    }

    const rows = await this.db
      .select({ id: repoGaps.id })
      .from(repoGaps)
      .where(and(eq(repoGaps.id, gapId), eq(repoGaps.repoConfigId, config.id)))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(`Gap ${gapId} not found for repo ${repoFullName}`);
    }

    await this.db.update(repoGaps).set({ status: "issue_created", issueUrl }).where(eq(repoGaps.id, gapId));
  }
}
