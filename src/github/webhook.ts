import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Engine } from "../engine/engine.js";
import type { IGitHubInstallationRepository } from "./installation-repo.js";

export interface GitHubWebhookDeps {
  engine: Engine;
  installationRepo: IGitHubInstallationRepository;
  webhookSecret: string;
  /** Flow name to create entities in when issues arrive. */
  defaultFlowName: string;
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function createGitHubWebhookRoutes(deps: GitHubWebhookDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.text();
    const signature = c.req.header("x-hub-signature-256") ?? "";

    if (!verifySignature(body, signature, deps.webhookSecret)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const event = c.req.header("x-github-event") ?? "";
    const payload = JSON.parse(body) as Record<string, unknown>;

    if (event === "installation") {
      return handleInstallation(deps, payload, c);
    }

    if (event === "issues") {
      return handleIssue(deps, payload, c);
    }

    // Ignore other events
    return c.json({ ok: true, ignored: true });
  });

  return app;
}

async function handleInstallation(
  deps: GitHubWebhookDeps,
  payload: Record<string, unknown>,
  c: import("hono").Context,
) {
  const action = payload.action as string;
  const installation = payload.installation as { id: number; account: { login: string } };

  if (action === "created") {
    // Find the tenant that initiated this installation via the setup URL
    // For now, store with a placeholder tenant — the UI flow will link it
    await deps.installationRepo.create("pending", installation.id, installation.account.login);
    return c.json({ ok: true, action: "installation_created" });
  }

  if (action === "deleted") {
    await deps.installationRepo.deleteByInstallationId(installation.id);
    return c.json({ ok: true, action: "installation_deleted" });
  }

  return c.json({ ok: true, ignored: true });
}

async function handleIssue(deps: GitHubWebhookDeps, payload: Record<string, unknown>, c: import("hono").Context) {
  const action = payload.action as string;

  // Only ingest newly opened issues
  if (action !== "opened") {
    return c.json({ ok: true, ignored: true });
  }

  const issue = payload.issue as { number: number; title: string; body: string | null; html_url: string };
  const repo = payload.repository as { full_name: string; clone_url: string };
  const installation = payload.installation as { id: number } | undefined;

  if (!installation) {
    return c.json({ error: "No installation context" }, 400);
  }

  // Look up which tenant this installation belongs to
  const inst = await deps.installationRepo.getByInstallationId(installation.id);
  if (!inst || inst.tenantId === "pending") {
    return c.json({ error: "Installation not linked to tenant" }, 400);
  }

  // Create entity in the flow
  try {
    const entity = await deps.engine.createEntity(deps.defaultFlowName, undefined, {
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      issueUrl: issue.html_url,
      repoFullName: repo.full_name,
      cloneUrl: repo.clone_url,
      installationId: installation.id,
      tenantId: inst.tenantId,
    });
    return c.json({ ok: true, entityId: entity.id }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
}
