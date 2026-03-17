import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/repositories/drizzle/schema.js", () => ({
  repoConfigs: { _: { name: "repoConfigs" }, id: "id", tenantId: "tenant_id", repo: "repo" },
  repoGaps: { _: { name: "repoGaps" }, id: "id", tenantId: "tenant_id", repoConfigId: "repo_config_id" },
}));

// Mock drizzle-orm operators to be identity functions for test DB
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));

import { InterrogationService } from "../../src/flows/interrogation-service.js";

// Mock fleet manager
function mockFleetManager() {
  return {
    provision: vi.fn().mockResolvedValue({ containerId: "ctr-123", runnerUrl: "http://runner:3001" }),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock DB that tracks inserts/updates/deletes
function mockDb() {
  const store: { repoConfigs: Record<string, unknown>[]; repoGaps: Record<string, unknown>[] } = {
    repoConfigs: [],
    repoGaps: [],
  };

  const db = {
    _store: store,
    insert: vi.fn().mockImplementation((table: { _: { name: string } }) => ({
      values: vi.fn().mockImplementation((rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const tableName = table._.name as keyof typeof store;
        const rowArray = Array.isArray(rows) ? rows : [rows];
        store[tableName]?.push(...rowArray);
        // Support both plain insert (gaps) and upsert chain (configs)
        return {
          then: (resolve: (v: unknown) => void) => resolve(undefined),
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: rowArray[0]?.id ?? "generated-id" }]),
          }),
        };
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return db;
}

// Sample SSE response with interrogation output
function makeSseResponse(output: string): string {
  const resultEvent = {
    type: "result",
    signal: "interrogation_complete",
    artifacts: { output },
    costUsd: 0.03,
  };
  return `data:${JSON.stringify(resultEvent)}\n`;
}

const SAMPLE_OUTPUT = `Some preamble text.

REPO_CONFIG:{"repo":"org/app","defaultBranch":"main","description":"A web app","languages":["typescript"],"monorepo":false,"ci":{"supported":true,"provider":"github-actions","gateCommand":"pnpm lint && pnpm build && pnpm test","hasMergeQueue":false,"requiredChecks":["build","test"]},"testing":{"supported":true,"framework":"vitest","runCommand":"pnpm test","hasCoverage":true,"coverageThreshold":98},"linting":{"supported":true,"tool":"biome","runCommand":"pnpm lint"},"formatting":{"supported":true,"tool":"biome","runCommand":"pnpm format"},"typeChecking":{"supported":true,"tool":"tsc","runCommand":"pnpm check"},"build":{"supported":true,"runCommand":"pnpm build","producesArtifacts":true,"dockerfile":false},"reviewBots":{"supported":false,"bots":[]},"docs":{"supported":false,"location":null,"hasApiDocs":false},"specManagement":{"tracker":"github-issues","specLocation":"issue-comments","hasTemplates":false},"security":{"hasEnvExample":false,"hasSecurityPolicy":false,"hasSecretScanning":false,"hasDependencyUpdates":false},"intelligence":{"hasKnowledgeMd":false,"hasAgentsMd":false,"conventions":["conventional-commits"],"ciGateCommand":"pnpm lint && pnpm build && pnpm test"}}
GAP:{"capability":"reviewBots","title":"Configure review bots","priority":"medium","description":"No review bots configured."}
GAP:{"capability":"docs","title":"Set up documentation","priority":"low","description":"No docs directory found."}
KNOWLEDGE_MD:# org/app

## CI Gate
pnpm lint && pnpm build && pnpm test

interrogation_complete`;

describe("InterrogationService", () => {
  let service: InterrogationService;
  let fleet: ReturnType<typeof mockFleetManager>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    fleet = mockFleetManager();
    db = mockDb();
    service = new InterrogationService({
      db,
      tenantId: "tenant-1",
      fleetManager: fleet,
      getGithubToken: async () => "ghp_test",
      dispatchTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provisions runner, dispatches prompt, parses result, stores in DB", async () => {
    const sseBody = makeSseResponse(SAMPLE_OUTPUT);

    // Mock fetch
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sseBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    const result = await service.interrogate("org/app");

    // Provisioned runner
    expect(fleet.provision).toHaveBeenCalledOnce();
    const provisionCall = fleet.provision.mock.calls[0];
    expect(provisionCall[1].owner).toBe("org");
    expect(provisionCall[1].repo).toBe("app");
    expect(provisionCall[1].flowName).toBe("interrogation");

    // Dispatched prompt
    expect(fetchSpy).toHaveBeenCalledOnce();
    const fetchArgs = fetchSpy.mock.calls[0];
    expect(fetchArgs[0]).toBe("http://runner:3001/dispatch");
    const fetchBody = JSON.parse((fetchArgs[1] as RequestInit).body as string);
    expect(fetchBody.prompt).toContain("org/app");
    expect(fetchBody.modelTier).toBe("sonnet");

    // Result
    expect(result.config.repo).toBe("org/app");
    expect(result.config.languages).toEqual(["typescript"]);
    expect(result.gaps).toHaveLength(2);
    expect(result.gaps[0].capability).toBe("reviewBots");
    expect(result.knowledgeMd).toContain("# org/app");

    // Stored in DB
    expect(db.insert).toHaveBeenCalled();
    expect(db._store.repoConfigs).toHaveLength(1);
    expect(db._store.repoGaps).toHaveLength(2);

    // Torn down runner
    expect(fleet.teardown).toHaveBeenCalledWith("ctr-123");

    fetchSpy.mockRestore();
  });

  it("tears down runner even on dispatch failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(service.interrogate("org/app")).rejects.toThrow("Dispatch failed: HTTP 500");
    expect(fleet.teardown).toHaveBeenCalledWith("ctr-123");

    fetchSpy.mockRestore();
  });

  it("tears down runner even on parse failure", async () => {
    // SSE with no REPO_CONFIG line
    const sseBody = makeSseResponse("Just some text with no config.\n\ninterrogation_complete");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }),
    );

    await expect(service.interrogate("org/app")).rejects.toThrow("missing REPO_CONFIG");
    expect(fleet.teardown).toHaveBeenCalledWith("ctr-123");

    fetchSpy.mockRestore();
  });

  it("rejects invalid repo name", async () => {
    await expect(service.interrogate("bad-name")).rejects.toThrow('Invalid repo name: bad-name');
  });

  it("handles SSE with text events instead of result artifact", async () => {
    // Some runners stream text events instead of putting output in result.artifacts
    const events = [
      `data:${JSON.stringify({ type: "content", text: "Some preamble.\n\n" })}\n`,
      `data:${JSON.stringify({ type: "content", text: `REPO_CONFIG:{"repo":"x/y","defaultBranch":"main","description":"test","languages":["go"],"monorepo":false,"ci":{"supported":false},"testing":{"supported":false},"linting":{"supported":false},"formatting":{"supported":false},"typeChecking":{"supported":false},"build":{"supported":false},"reviewBots":{"supported":false},"docs":{"supported":false},"specManagement":{"tracker":"github-issues"},"security":{},"intelligence":{"hasKnowledgeMd":false,"hasAgentsMd":false,"conventions":[],"ciGateCommand":null}}\n` })}\n`,
      `data:${JSON.stringify({ type: "content", text: "KNOWLEDGE_MD:EXISTS\n\ninterrogation_complete" })}\n`,
    ];
    const sseBody = events.join("");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }),
    );

    const result = await service.interrogate("x/y");
    expect(result.config.repo).toBe("x/y");
    expect(result.config.languages).toEqual(["go"]);
    expect(result.gaps).toHaveLength(0);
    expect(result.knowledgeMd).toBeNull();

    fetchSpy.mockRestore();
  });

  it("upserts atomically via ON CONFLICT when config already exists", async () => {
    // Make the onConflictDoUpdate returning() return the existing ID
    const onConflictReturn = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "existing-id" }]),
    });
    db.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        then: (resolve: (v: unknown) => void) => resolve(undefined),
        onConflictDoUpdate: onConflictReturn,
      }),
    }));

    const sseBody = makeSseResponse(SAMPLE_OUTPUT);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sseBody, { status: 200 }),
    );

    const result = await service.interrogate("org/app");
    expect(result.repoConfigId).toBe("existing-id");

    // Should use atomic upsert (onConflictDoUpdate), not separate select+update
    expect(onConflictReturn).toHaveBeenCalled();
    // Should have deleted old gaps before inserting fresh ones
    expect(db.delete).toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
