/**
 * Flow editor REST routes.
 *
 * Endpoints for reading and writing .holyship/flow.yml from a customer repo.
 */

import { Hono } from "hono";
import { parse as parseYaml } from "yaml";
import type { FlowEditService } from "../flows/flow-edit-service.js";

export interface FlowEditorRouteDeps {
  getGithubToken: () => Promise<string | null>;
  flowEditService?: FlowEditService;
}

export function createFlowEditorRoutes(deps: FlowEditorRouteDeps): Hono {
  const app = new Hono();

  // GET /repos/:owner/:repo/flow — read .holyship/flow.yml
  app.get("/repos/:owner/:repo/flow", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");

    const token = await deps.getGithubToken();
    if (!token) {
      return c.json({ error: "GitHub App not configured" }, 501);
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/.holyship/flow.yml`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 404) {
      return c.json({ error: "No flow.yml found. Create .holyship/flow.yml to get started." }, 404);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json({ error: `GitHub API error: ${res.status}`, detail: text.slice(0, 500) }, 502);
    }

    const data = (await res.json()) as { content: string; sha: string; encoding: string };

    if (data.encoding !== "base64") {
      return c.json({ error: `Unexpected encoding: ${data.encoding}` }, 502);
    }

    const yaml = Buffer.from(data.content, "base64").toString("utf-8");

    let flow: unknown;
    try {
      flow = parseYaml(yaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Invalid YAML in flow.yml", detail: message }, 422);
    }

    return c.json({ yaml, flow, sha: data.sha }, 200);
  });

  // POST /repos/:owner/:repo/flow/edit — edit flow via natural language
  app.post("/repos/:owner/:repo/flow/edit", async (c) => {
    if (!deps.flowEditService) {
      return c.json({ error: "Flow edit service not configured" }, 501);
    }

    const owner = c.req.param("owner");
    const repo = c.req.param("repo");

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { message, currentYaml } = body;

    if (typeof message !== "string" || message.trim() === "") {
      return c.json({ error: "message must be a non-empty string" }, 400);
    }
    if (typeof currentYaml !== "string") {
      return c.json({ error: "currentYaml must be a string" }, 400);
    }

    try {
      const result = await deps.flowEditService.editFlow(`${owner}/${repo}`, message.trim(), currentYaml);

      let updatedFlow: unknown;
      try {
        updatedFlow = parseYaml(result.updatedYaml);
      } catch {
        updatedFlow = null;
      }

      return c.json(
        {
          updatedYaml: result.updatedYaml,
          updatedFlow,
          explanation: result.explanation,
          diff: result.diff,
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Flow edit failed", detail: message }, 500);
    }
  });

  // POST /repos/:owner/:repo/flow/apply — create PR with updated flow.yml
  app.post("/repos/:owner/:repo/flow/apply", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");

    const token = await deps.getGithubToken();
    if (!token) {
      return c.json({ error: "GitHub App not configured" }, 501);
    }

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { yaml, commitMessage, baseSha } = body;

    if (typeof yaml !== "string" || yaml.trim() === "") {
      return c.json({ error: "yaml must be a non-empty string" }, 422);
    }
    if (typeof baseSha !== "string" || baseSha.trim() === "") {
      return c.json({ error: "baseSha must be a non-empty string" }, 400);
    }

    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    // Step 1: Get default branch + its HEAD SHA
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders,
    });
    if (!repoRes.ok) {
      const text = await repoRes.text().catch(() => "");
      return c.json({ error: `GitHub API error fetching repo: ${repoRes.status}`, detail: text.slice(0, 500) }, 502);
    }
    const repoData = (await repoRes.json()) as { default_branch: string };
    const defaultBranch = repoData.default_branch;

    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, {
      headers: ghHeaders,
    });
    if (!refRes.ok) {
      const text = await refRes.text().catch(() => "");
      return c.json({ error: `GitHub API error fetching ref: ${refRes.status}`, detail: text.slice(0, 500) }, 502);
    }
    const refData = (await refRes.json()) as { object: { sha: string } };
    const baseBranchSha = refData.object.sha;

    // Step 2: Create branch
    const branch = `holyship/flow-update-${Date.now()}`;
    const createBranchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseBranchSha }),
    });
    if (!createBranchRes.ok) {
      const text = await createBranchRes.text().catch(() => "");
      return c.json(
        { error: `GitHub API error creating branch: ${createBranchRes.status}`, detail: text.slice(0, 500) },
        502,
      );
    }

    // Step 3: Update (or create) .holyship/flow.yml on the new branch
    const content = Buffer.from(yaml, "utf-8").toString("base64");
    const fileBody: Record<string, unknown> = {
      message:
        typeof commitMessage === "string" && commitMessage.trim() ? commitMessage.trim() : "chore: update flow.yml",
      content,
      branch,
    };
    // baseSha is the file blob SHA (for update); if it's a new file this would be omitted,
    // but the caller always supplies it from GET /flow.
    fileBody.sha = baseSha.trim();

    const updateFileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.holyship/flow.yml`, {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify(fileBody),
    });

    if (updateFileRes.status === 409) {
      return c.json({ error: "baseSha is stale. Fetch the latest flow.yml and retry." }, 409);
    }
    if (!updateFileRes.ok) {
      const text = await updateFileRes.text().catch(() => "");
      return c.json(
        { error: `GitHub API error updating file: ${updateFileRes.status}`, detail: text.slice(0, 500) },
        502,
      );
    }

    // Step 4: Create PR
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({
        title:
          typeof commitMessage === "string" && commitMessage.trim() ? commitMessage.trim() : "chore: update flow.yml",
        head: branch,
        base: defaultBranch,
        body: "Flow definition updated via Holy Ship flow editor.",
      }),
    });

    if (!prRes.ok) {
      const text = await prRes.text().catch(() => "");
      return c.json({ error: `GitHub API error creating PR: ${prRes.status}`, detail: text.slice(0, 500) }, 502);
    }

    const prData = (await prRes.json()) as { html_url: string; number: number };
    return c.json({ prUrl: prData.html_url, prNumber: prData.number, branch }, 200);
  });

  return app;
}
