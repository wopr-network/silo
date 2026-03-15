import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { IGitHubInstallationRepository } from "./installation-repo.js";

export interface GitHubWebhookDeps {
  installationRepo: IGitHubInstallationRepository;
  webhookSecret: string;
  tenantId: string;
  onIssueOpened?: (payload: {
    installationId: number;
    owner: string;
    repo: string;
    issueNumber: number;
    issueTitle: string;
    issueBody: string;
  }) => Promise<void>;
}

function verifySignature(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function createGitHubWebhookRoutes(deps: GitHubWebhookDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");

    if (!verifySignature(deps.webhookSecret, rawBody, signature)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const event = c.req.header("x-github-event");
    // biome-ignore lint/suspicious/noExplicitAny: GitHub webhook payloads are dynamic
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (event === "installation") {
      const action = payload.action as string;
      const installation = payload.installation;

      if (action === "created") {
        await deps.installationRepo.upsert({
          tenantId: deps.tenantId,
          installationId: installation.id,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
          accessToken: null,
          tokenExpiresAt: null,
        });
      } else if (action === "deleted") {
        await deps.installationRepo.remove(installation.id);
      }

      return c.json({ ok: true });
    }

    if (event === "issues" && payload.action === "opened") {
      const issue = payload.issue;
      const repo = payload.repository;

      if (deps.onIssueOpened) {
        await deps.onIssueOpened({
          installationId: payload.installation.id,
          owner: repo.owner.login,
          repo: repo.name,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body ?? "",
        });
      }

      return c.json({ ok: true });
    }

    // Unhandled event
    return c.json({ ok: true, ignored: true });
  });

  return app;
}
