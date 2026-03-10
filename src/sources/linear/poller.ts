import type { Ingestor } from "../../ingestion/ingestor.js";
import { logger } from "../../logger.js";
import { safeErrorMessage } from "../sanitize.js";
import type { LinearClient } from "./client.js";
import { extractReposFromDescription } from "./repo-extractor.js";
import type { LinearSearchIssue } from "./types.js";

export interface LinearWatchConfig {
  id: string;
  sourceId: string;
  flowName: string;
  filter: { state?: string; labels?: string[]; teamIds?: string[] };
}

export interface LinearPollerConfig {
  linearClient: LinearClient;
  ingestor: Ingestor;
  watches: LinearWatchConfig[];
  intervalMs?: number;
}

export class LinearPoller {
  private linearClient: LinearClient;
  private ingestor: Ingestor;
  private watches: LinearWatchConfig[];
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  // In-flight guard: prevents concurrent poll runs from overlapping if a poll
  // takes longer than the interval.
  private isPolling = false;

  constructor(config: LinearPollerConfig) {
    this.linearClient = config.linearClient;
    this.ingestor = config.ingestor;
    this.watches = config.watches;
    this.intervalMs = config.intervalMs ?? 60_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.isPolling) return;
      this.pollOnce().catch((err) => {
        logger.error("[LinearPoller] poll error", { error: safeErrorMessage(err) });
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this._doPoll();
    } finally {
      this.isPolling = false;
    }
  }

  private async _doPoll(): Promise<void> {
    // Group watches by (state, teamIds) so each unique combination gets one API call.
    // teamIds are sorted and joined to form a stable key.
    const groupKey = (w: LinearWatchConfig): string => {
      const state = w.filter.state ?? "";
      const teamIds = Array.isArray(w.filter.teamIds) ? w.filter.teamIds : [];
      const teams = teamIds.slice().sort().join(",");
      return `${state}\0${teams}`;
    };

    const byGroup = new Map<string, LinearWatchConfig[]>();
    for (const watch of this.watches) {
      const key = groupKey(watch);
      const existing = byGroup.get(key) ?? [];
      existing.push(watch);
      byGroup.set(key, existing);
    }

    for (const [, watches] of byGroup) {
      const { state } = watches[0].filter;
      const teamIds = Array.isArray(watches[0].filter.teamIds) ? watches[0].filter.teamIds : [];
      const searchFilter: { stateName?: string; teamIds?: string[] } = {};
      if (state) searchFilter.stateName = state;
      if (teamIds.length > 0) searchFilter.teamIds = teamIds;

      let issues: LinearSearchIssue[];
      try {
        issues = await this.linearClient.searchIssues(Object.keys(searchFilter).length > 0 ? searchFilter : {});
      } catch (err) {
        logger.error("[LinearPoller] Failed to fetch issues", {
          state: state ?? "all",
          teams: teamIds?.join(",") ?? "all",
          error: safeErrorMessage(err),
        });
        continue;
      }

      for (const issue of issues) {
        for (const watch of watches) {
          if (!this.matchesFilter(issue, watch.filter)) continue;

          const repos = extractReposFromDescription(issue.description);

          try {
            await this.ingestor.ingest({
              sourceId: watch.sourceId,
              externalId: issue.id,
              type: "new",
              flowName: watch.flowName,
              payload: {
                repos,
                refs: {
                  linear: {
                    id: issue.id,
                    key: issue.identifier,
                    title: issue.title,
                    description: issue.description,
                  },
                  github: { repo: repos[0] ?? null },
                },
              },
            });
          } catch (err) {
            logger.error(`[LinearPoller] Failed to ingest ${issue.identifier}`, { error: safeErrorMessage(err) });
          }
        }
      }
    }
  }

  private matchesFilter(
    issue: LinearSearchIssue,
    filter: { state?: string; labels?: string[]; teamIds?: string[] },
  ): boolean {
    if (filter.state && issue.state.name !== filter.state) return false;

    if (filter.labels && filter.labels.length > 0) {
      const issueLabels = new Set(issue.labels.map((l) => l.name));
      const hasMatch = filter.labels.some((l) => issueLabels.has(l));
      if (!hasMatch) return false;
    }

    const teamIds = Array.isArray(filter.teamIds) ? filter.teamIds : [];
    if (teamIds.length > 0) {
      if (!teamIds.includes(issue.team?.id ?? "")) return false;
    }

    return true;
  }
}
