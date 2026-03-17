import { describe, expect, it, vi } from "vitest";
import { createInterrogationRoutes } from "../../src/routes/interrogation.js";
import { GapAlreadyActualizedError, type GapActualizationService, GapNotFoundError } from "../../src/flows/gap-actualization-service.js";
import type { InterrogationService } from "../../src/flows/interrogation-service.js";

function mockService(): InterrogationService {
  return {
    interrogate: vi.fn(),
    getConfig: vi.fn(),
    getGaps: vi.fn(),
    linkGapToIssue: vi.fn(),
  } as unknown as InterrogationService;
}

describe("createInterrogationRoutes", () => {
  it("POST /repos/:owner/:repo/interrogate returns config summary", async () => {
    const svc = mockService();
    vi.mocked(svc.interrogate).mockResolvedValue({
      repoConfigId: "cfg-1",
      config: {
        repo: "org/app",
        defaultBranch: "main",
        description: "A web app",
        languages: ["typescript"],
        monorepo: false,
        ci: { supported: true },
        testing: { supported: true },
        linting: { supported: true },
        formatting: { supported: true },
        typeChecking: { supported: true },
        build: { supported: true },
        reviewBots: { supported: false },
        docs: { supported: false },
        specManagement: { tracker: "github-issues" },
        security: {},
        intelligence: { hasKnowledgeMd: false, hasAgentsMd: false, conventions: [] },
      },
      gaps: [
        { capability: "reviewBots", title: "Configure review bots", priority: "medium" as const, description: "No bots" },
      ],
      knowledgeMd: "# org/app",
    });

    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/interrogate", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repo).toBe("org/app");
    expect(body.gapCount).toBe(1);
    expect(body.hasKnowledgeMd).toBe(true);
    expect(svc.interrogate).toHaveBeenCalledWith("org/app");
  });

  it("POST /repos/:owner/:repo/interrogate returns 500 on failure", async () => {
    const svc = mockService();
    vi.mocked(svc.interrogate).mockRejectedValue(new Error("Runner down"));

    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/interrogate", { method: "POST" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Interrogation failed");
    expect(body.detail).toContain("Runner down");
  });

  it("GET /repos/:owner/:repo/config returns stored config", async () => {
    const svc = mockService();
    vi.mocked(svc.getConfig).mockResolvedValue({
      id: "cfg-1",
      config: { repo: "org/app", defaultBranch: "main" } as any,
      knowledgeMd: "# org/app",
    });

    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/config");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.repo).toBe("org/app");
    expect(body.knowledgeMd).toBe("# org/app");
  });

  it("GET /repos/:owner/:repo/config returns 404 when no config", async () => {
    const svc = mockService();
    vi.mocked(svc.getConfig).mockResolvedValue(null);

    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/config");

    expect(res.status).toBe(404);
  });

  it("GET /repos/:owner/:repo/gaps returns gap checklist", async () => {
    const svc = mockService();
    vi.mocked(svc.getGaps).mockResolvedValue([
      { id: "g-1", capability: "ci", title: "Set up CI", priority: "high" as const, description: "No CI", status: "open", issueUrl: null },
      { id: "g-2", capability: "docs", title: "Add docs", priority: "low" as const, description: "No docs", status: "issue_created", issueUrl: "https://github.com/org/app/issues/1" },
    ]);

    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/gaps");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gaps).toHaveLength(2);
    expect(body.gaps[0].status).toBe("open");
    expect(body.gaps[1].issueUrl).toContain("github.com");
  });

  it("POST /repos/:owner/:repo/gaps/:gapId/link-issue links issue", async () => {
    const svc = mockService();
    vi.mocked(svc.linkGapToIssue).mockResolvedValue(undefined);

    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/gaps/g-1/link-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue_url: "https://github.com/org/app/issues/5" }),
    });

    expect(res.status).toBe(200);
    expect(svc.linkGapToIssue).toHaveBeenCalledWith("g-1", "org/app", "https://github.com/org/app/issues/5");
  });

  it("POST link-issue returns 400 without issue_url", async () => {
    const svc = mockService();
    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/gaps/g-1/link-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("POST /repos/:owner/:repo/gaps/:gapId/create-issue creates issue", async () => {
    const svc = mockService();
    const gapSvc = {
      createIssueFromGap: vi.fn().mockResolvedValue({
        gapId: "g-1",
        issueNumber: 42,
        issueUrl: "https://github.com/org/app/issues/42",
      }),
      createIssuesFromAllGaps: vi.fn(),
    } as unknown as GapActualizationService;

    const app = createInterrogationRoutes({ interrogationService: svc, gapActualizationService: gapSvc });
    const res = await app.request("/repos/org/app/gaps/g-1/create-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.issueNumber).toBe(42);
    expect(gapSvc.createIssueFromGap).toHaveBeenCalledWith("org/app", "g-1", { createEntity: false });
  });

  it("POST create-issue passes create_entity flag", async () => {
    const svc = mockService();
    const gapSvc = {
      createIssueFromGap: vi.fn().mockResolvedValue({ gapId: "g-1", issueNumber: 42, issueUrl: "url" }),
      createIssuesFromAllGaps: vi.fn(),
    } as unknown as GapActualizationService;

    const app = createInterrogationRoutes({ interrogationService: svc, gapActualizationService: gapSvc });
    await app.request("/repos/org/app/gaps/g-1/create-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create_entity: true }),
    });

    expect(gapSvc.createIssueFromGap).toHaveBeenCalledWith("org/app", "g-1", { createEntity: true });
  });

  it("POST create-issue returns 501 when service not configured", async () => {
    const svc = mockService();
    const app = createInterrogationRoutes({ interrogationService: svc });
    const res = await app.request("/repos/org/app/gaps/g-1/create-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(501);
  });

  it("POST /repos/:owner/:repo/gaps/create-all creates all issues", async () => {
    const svc = mockService();
    const gapSvc = {
      createIssueFromGap: vi.fn(),
      createIssuesFromAllGaps: vi.fn().mockResolvedValue([
        { gapId: "g-1", issueNumber: 50, issueUrl: "url1" },
        { gapId: "g-2", issueNumber: 51, issueUrl: "url2" },
      ]),
    } as unknown as GapActualizationService;

    const app = createInterrogationRoutes({ interrogationService: svc, gapActualizationService: gapSvc });
    const res = await app.request("/repos/org/app/gaps/create-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(2);
    expect(body.issues).toHaveLength(2);
  });

  it("POST create-issue returns 404 for GapNotFoundError", async () => {
    const svc = mockService();
    const gapSvc = {
      createIssueFromGap: vi.fn().mockRejectedValue(new GapNotFoundError("g-99", "org/app")),
      createIssuesFromAllGaps: vi.fn(),
    } as unknown as GapActualizationService;

    const app = createInterrogationRoutes({ interrogationService: svc, gapActualizationService: gapSvc });
    const res = await app.request("/repos/org/app/gaps/g-99/create-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  it("POST create-issue returns 409 for GapAlreadyActualizedError", async () => {
    const svc = mockService();
    const gapSvc = {
      createIssueFromGap: vi.fn().mockRejectedValue(new GapAlreadyActualizedError("g-1", "https://github.com/org/app/issues/5")),
      createIssuesFromAllGaps: vi.fn(),
    } as unknown as GapActualizationService;

    const app = createInterrogationRoutes({ interrogationService: svc, gapActualizationService: gapSvc });
    const res = await app.request("/repos/org/app/gaps/g-1/create-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
  });

  it("POST create-all returns 200 when no gaps created", async () => {
    const svc = mockService();
    const gapSvc = {
      createIssueFromGap: vi.fn(),
      createIssuesFromAllGaps: vi.fn().mockResolvedValue([]),
    } as unknown as GapActualizationService;

    const app = createInterrogationRoutes({ interrogationService: svc, gapActualizationService: gapSvc });
    const res = await app.request("/repos/org/app/gaps/create-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
  });
});
