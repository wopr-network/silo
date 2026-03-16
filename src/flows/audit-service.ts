/**
 * Audit Service — finds what's wrong with a repo right now.
 *
 * Dispatches an audit prompt to a runner, parses the proposed issues,
 * and stores them for the UI to present as a checklist with "Create Issue" buttons.
 */

import { and, eq } from "drizzle-orm";
import type { IFleetManager, ProvisionConfig } from "../fleet/provision-holyshipper.js";
import { logger } from "../logger.js";
import { repoConfigs, repoGaps } from "../repositories/drizzle/schema.js";
import type { AuditCategory, AuditConfig, ProposedIssue } from "./audit-prompt.js";
import { parseAuditOutput, renderAuditPrompt } from "./audit-prompt.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
type Db = any;

export interface AuditServiceConfig {
  db: Db;
  tenantId: string;
  fleetManager: IFleetManager;
  getGithubToken: () => Promise<string | null>;
  dispatchTimeoutMs?: number;
}

export interface AuditResult {
  repoConfigId: string;
  issues: ProposedIssue[];
  categories: AuditCategory[];
}

export class AuditService {
  private readonly db: Db;
  private readonly tenantId: string;
  private readonly fleetManager: IFleetManager;
  private readonly getGithubToken: () => Promise<string | null>;
  private readonly dispatchTimeoutMs: number;

  constructor(config: AuditServiceConfig) {
    this.db = config.db;
    this.tenantId = config.tenantId;
    this.fleetManager = config.fleetManager;
    this.getGithubToken = config.getGithubToken;
    this.dispatchTimeoutMs = config.dispatchTimeoutMs ?? 600_000;
  }

  /**
   * Run an audit on a repo. Dispatches the audit prompt to a runner,
   * parses proposed issues, and stores them as gaps for the checklist UI.
   */
  async audit(repoFullName: string, config: AuditConfig): Promise<AuditResult> {
    const tag = "[audit]";
    logger.info(`${tag} starting`, { repo: repoFullName, categories: config.categories });

    const [owner = "", repo = ""] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repo name: ${repoFullName}`);
    }

    if (config.categories.length === 0) {
      throw new Error("At least one audit category must be selected");
    }

    const prompt = renderAuditPrompt(repoFullName, config);

    let githubToken = "";
    try {
      githubToken = (await this.getGithubToken()) ?? "";
    } catch (err) {
      logger.warn(`${tag} github token failed`, { error: String(err) });
    }

    const entityId = `audit-${crypto.randomUUID()}`;
    const provisionConfig: ProvisionConfig = {
      entityId,
      flowName: "audit",
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
      const issues = parseAuditOutput(rawOutput);

      logger.info(`${tag} complete`, {
        repo: repoFullName,
        issueCount: issues.length,
        categories: config.categories,
      });

      // Store issues as gaps (reuses the gap checklist infrastructure)
      const repoConfigId = await this.storeAuditResults(repoFullName, issues, config.categories);

      return { repoConfigId, issues, categories: config.categories };
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
   * Store audit results as gaps in the existing repo_gaps table.
   * Audit gaps are additive — they don't replace interrogation gaps.
   */
  private async storeAuditResults(
    repoFullName: string,
    issues: ProposedIssue[],
    categories: AuditCategory[],
  ): Promise<string> {
    const now = new Date();

    // Ensure repo config exists (may not if audit runs before interrogation)
    const existing = await this.db
      .select({ id: repoConfigs.id })
      .from(repoConfigs)
      .where(and(eq(repoConfigs.tenantId, this.tenantId), eq(repoConfigs.repo, repoFullName)))
      .limit(1);

    let repoConfigId: string;
    if (existing.length > 0) {
      repoConfigId = existing[0].id as string;
    } else {
      repoConfigId = crypto.randomUUID();
      await this.db.insert(repoConfigs).values({
        id: repoConfigId,
        tenantId: this.tenantId,
        repo: repoFullName,
        config: {},
        status: "audit_only",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Delete previous audit gaps for these categories (keep interrogation gaps)
    for (const cat of categories) {
      await this.db
        .delete(repoGaps)
        .where(and(eq(repoGaps.repoConfigId, repoConfigId), eq(repoGaps.capability, `audit:${cat}`)));
    }

    // Insert new audit gaps
    if (issues.length > 0) {
      await this.db.insert(repoGaps).values(
        issues.map((issue) => ({
          id: crypto.randomUUID(),
          tenantId: this.tenantId,
          repoConfigId,
          capability: `audit:${issue.category}`,
          title: issue.title,
          priority: issue.priority,
          description:
            issue.file && issue.line
              ? `${issue.description}\n\nFile: ${issue.file}:${issue.line}`
              : issue.file
                ? `${issue.description}\n\nFile: ${issue.file}`
                : issue.description,
          status: "open",
          createdAt: now,
        })),
      );
    }

    return repoConfigId;
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
