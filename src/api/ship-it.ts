import { Hono } from "hono";
import type { Engine } from "../engine/engine.js";
import type { EntityLifecycleManager } from "../fleet/entity-lifecycle.js";
import type { GitHubInstallationRepo } from "../github/installation-repo.js";
import { generateInstallationToken } from "../github/token-generator.js";

export interface ShipItDeps {
  engine: Engine;
  lifecycle: EntityLifecycleManager;
  installationRepo: GitHubInstallationRepo;
  githubAppId: string;
  githubAppPrivateKey: string;
  defaultFlowName: string;
}

export function createShipItRoutes(deps: ShipItDeps): Hono {
  const app = new Hono();

  /**
   * POST /api/ship-it
   *
   * Body: { owner: string, repo: string, issueNumber: number }
   *   or: { issueUrl: string }
   *
   * Fetches issue from GitHub, creates entity, provisions holyshipper.
   */
  app.post("/", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();

    // Parse issue reference
    let owner: string;
    let repo: string;
    let issueNumber: number;

    if (body.issueUrl) {
      // Parse https://github.com/owner/repo/issues/123
      const match = (body.issueUrl as string).match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
      if (!match) return c.json({ error: "Invalid issue URL" }, 400);
      [, owner, repo, issueNumber] = [match[0], match[1], match[2], Number.parseInt(match[3], 10)];
    } else if (body.owner && body.repo && body.issueNumber) {
      owner = body.owner as string;
      repo = body.repo as string;
      issueNumber = body.issueNumber as number;
    } else {
      return c.json({ error: "Provide issueUrl or owner+repo+issueNumber" }, 400);
    }

    // Find installation for this tenant
    // TODO: resolve tenantId from platform-core session
    const tenantId = "default";
    const installations = await deps.installationRepo.getByTenantId(tenantId);
    if (installations.length === 0) {
      return c.json({ error: "No GitHub App installed. Connect GitHub first." }, 400);
    }

    // Use first installation (TODO: match by repo owner)
    const installation = installations[0];

    // Fetch issue details from GitHub
    const { token } = await generateInstallationToken(
      installation.installationId,
      deps.githubAppId,
      deps.githubAppPrivateKey,
    );

    const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!issueRes.ok) {
      return c.json({ error: `GitHub API error: ${issueRes.status}` }, 502);
    }

    const issue = (await issueRes.json()) as { title: string; body: string | null; html_url: string };

    // Create entity in flow
    const entity = await deps.engine.createEntity(deps.defaultFlowName, undefined, {
      issueNumber,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      issueUrl: issue.html_url,
      repoFullName: `${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      installationId: installation.installationId,
      tenantId,
    });

    // Provision holyshipper
    await deps.lifecycle.provisionForEntity({
      entityId: entity.id,
      tenantId,
      installationId: installation.installationId,
      discipline: "engineering",
      repoFullName: `${owner}/${repo}`,
    });

    return c.json({ ok: true, entityId: entity.id, message: "Holy Ship, it's shipping!" }, 201);
  });

  return app;
}
