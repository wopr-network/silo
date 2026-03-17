/**
 * Flow editor REST routes.
 *
 * Endpoints for reading and writing .holyship/flow.yml from a customer repo.
 */

import { Hono } from "hono";
import { parse as parseYaml } from "yaml";

export interface FlowEditorRouteDeps {
  getGithubToken: () => Promise<string | null>;
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

  return app;
}
