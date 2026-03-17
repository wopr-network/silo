/**
 * Interrogation REST routes.
 *
 * Endpoints for triggering repo interrogation, retrieving stored configs,
 * viewing gap checklists, and creating issues from gaps.
 */

import { Hono } from "hono";
import {
  type GapActualizationService,
  GapAlreadyActualizedError,
  GapNotFoundError,
} from "../flows/gap-actualization-service.js";
import type { InterrogationService } from "../flows/interrogation-service.js";

export interface InterrogationRouteDeps {
  interrogationService: InterrogationService;
  gapActualizationService?: GapActualizationService;
}

export function createInterrogationRoutes(deps: InterrogationRouteDeps): Hono {
  const app = new Hono();

  // POST /repos/:owner/:repo/interrogate — trigger interrogation
  app.post("/repos/:owner/:repo/interrogate", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoFullName = `${owner}/${repo}`;

    try {
      const result = await deps.interrogationService.interrogate(repoFullName);
      return c.json(
        {
          repoConfigId: result.repoConfigId,
          repo: repoFullName,
          description: result.config.description,
          languages: result.config.languages,
          gapCount: result.gaps.length,
          gaps: result.gaps.map((g) => ({
            capability: g.capability,
            title: g.title,
            priority: g.priority,
          })),
          hasKnowledgeMd: result.knowledgeMd !== null,
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Interrogation failed", detail: message }, 500);
    }
  });

  // GET /repos/:owner/:repo/config — get stored repo config
  app.get("/repos/:owner/:repo/config", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoFullName = `${owner}/${repo}`;

    const result = await deps.interrogationService.getConfig(repoFullName);
    if (!result) {
      return c.json({ error: "No config found. Run interrogation first." }, 404);
    }
    return c.json({ id: result.id, config: result.config, knowledgeMd: result.knowledgeMd }, 200);
  });

  // GET /repos/:owner/:repo/gaps — get gap checklist
  app.get("/repos/:owner/:repo/gaps", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoFullName = `${owner}/${repo}`;

    const gaps = await deps.interrogationService.getGaps(repoFullName);
    return c.json({ repo: repoFullName, gaps }, 200);
  });

  // POST /repos/:owner/:repo/gaps/:gapId/link-issue — link gap to created issue
  app.post("/repos/:owner/:repo/gaps/:gapId/link-issue", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoFullName = `${owner}/${repo}`;
    const gapId = c.req.param("gapId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const issueUrl = body.issue_url as string;
    if (!issueUrl) {
      return c.json({ error: "issue_url is required" }, 400);
    }

    try {
      await deps.interrogationService.linkGapToIssue(gapId, repoFullName, issueUrl);
      return c.json({ ok: true }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Failed to link issue", detail: message }, 500);
    }
  });

  // POST /repos/:owner/:repo/gaps/:gapId/create-issue — create GitHub issue from gap
  app.post("/repos/:owner/:repo/gaps/:gapId/create-issue", async (c) => {
    if (!deps.gapActualizationService) {
      return c.json({ error: "Gap actualization not configured" }, 501);
    }
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoFullName = `${owner}/${repo}`;
    const gapId = c.req.param("gapId");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const createEntity = body.create_entity === true;

    try {
      const result = await deps.gapActualizationService.createIssueFromGap(repoFullName, gapId, { createEntity });
      return c.json(result, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof GapNotFoundError) return c.json({ error: message }, 404);
      if (err instanceof GapAlreadyActualizedError) return c.json({ error: message }, 409);
      return c.json({ error: message }, 500);
    }
  });

  // POST /repos/:owner/:repo/gaps/create-all — create issues for all open gaps
  app.post("/repos/:owner/:repo/gaps/create-all", async (c) => {
    if (!deps.gapActualizationService) {
      return c.json({ error: "Gap actualization not configured" }, 501);
    }
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoFullName = `${owner}/${repo}`;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const createEntity = body.create_entity === true;

    try {
      const results = await deps.gapActualizationService.createIssuesFromAllGaps(repoFullName, { createEntity });
      const statusCode = results.length > 0 ? 201 : 200;
      return c.json({ repo: repoFullName, created: results.length, issues: results }, statusCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
