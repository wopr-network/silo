import { Hono } from "hono";
import type { Engine } from "../engine/engine.js";

export interface ShipItDeps {
  engine: Engine;
  /** Function to fetch issue details from GitHub. */
  fetchIssue: (
    owner: string,
    repo: string,
    issueNumber: number,
  ) => Promise<{
    title: string;
    body: string;
    htmlUrl: string;
  }>;
}

/**
 * POST /api/ship-it
 * Accepts either { issueUrl } or { owner, repo, issueNumber }.
 * Fetches the issue from GitHub, creates an entity, and provisions a holyshipper.
 */
export function createShipItRoutes(deps: ShipItDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    let owner: string;
    let repo: string;
    let issueNumber: number;

    if (typeof body.issueUrl === "string") {
      // Parse: https://github.com/owner/repo/issues/123
      const match = body.issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
      if (!match) {
        return c.json({ error: "Invalid issueUrl format. Expected: https://github.com/owner/repo/issues/123" }, 400);
      }
      owner = match[1];
      repo = match[2];
      issueNumber = parseInt(match[3], 10);
    } else if (
      typeof body.owner === "string" &&
      typeof body.repo === "string" &&
      typeof body.issueNumber === "number"
    ) {
      owner = body.owner;
      repo = body.repo;
      issueNumber = body.issueNumber;
    } else {
      return c.json({ error: "Provide either issueUrl or { owner, repo, issueNumber }" }, 400);
    }

    // Fetch issue from GitHub
    let issue: { title: string; body: string; htmlUrl: string };
    try {
      issue = await deps.fetchIssue(owner, repo, issueNumber);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to fetch issue: ${msg}` }, 502);
    }

    // Create entity with flow "ship-it" (or configurable)
    const flowName = (body.flow as string) ?? "ship-it";
    try {
      const entity = await deps.engine.createEntity(flowName, undefined, {
        owner,
        repo,
        issueNumber,
        issueTitle: issue.title,
        issueBody: issue.body,
        issueUrl: issue.htmlUrl,
      });
      return c.json({ entityId: entity.id, state: entity.state }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  return app;
}
