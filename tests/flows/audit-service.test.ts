import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/repositories/drizzle/schema.js", () => ({
  repoConfigs: { _: { name: "repoConfigs" }, id: "id", tenantId: "tenant_id", repo: "repo" },
  repoGaps: { _: { name: "repoGaps" }, id: "id", tenantId: "tenant_id", repoConfigId: "repo_config_id", capability: "capability" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));

import { AuditService } from "../../src/flows/audit-service.js";

function mockFleetManager() {
  return {
    provision: vi.fn().mockResolvedValue({ containerId: "ctr-audit", runnerUrl: "http://runner:3001" }),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
}

function mockDb() {
  const store: { repoConfigs: Record<string, unknown>[]; repoGaps: Record<string, unknown>[] } = {
    repoConfigs: [],
    repoGaps: [],
  };

  return {
    _store: store,
    insert: vi.fn().mockImplementation((table: { _: { name: string } }) => ({
      values: vi.fn().mockImplementation((rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const tableName = table._.name as keyof typeof store;
        const rowArray = Array.isArray(rows) ? rows : [rows];
        store[tableName]?.push(...rowArray);
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
          limit: vi.fn().mockResolvedValue([{ id: "existing-config-id" }]),
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
}

const SAMPLE_SSE = `data:${JSON.stringify({
  type: "result",
  artifacts: {
    output: `Found several issues.

ISSUE:{"category":"code_quality","title":"Extract auth middleware from server.ts","priority":"medium","file":"src/server.ts","line":145,"description":"server.ts is 680 lines."}
ISSUE:{"category":"security","title":"Fix command injection in deploy script","priority":"critical","file":"src/deploy.ts","line":34,"description":"exec() with unsanitized input."}
ISSUE:{"category":"test_coverage","title":"Add tests for user service","priority":"high","file":"src/services/user.ts","description":"No test file exists."}

audit_complete`,
  },
})}\n`;

describe("AuditService", () => {
  let service: AuditService;
  let fleet: ReturnType<typeof mockFleetManager>;
  let db: ReturnType<typeof mockDb>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fleet = mockFleetManager();
    db = mockDb();
    service = new AuditService({
      db,
      tenantId: "tenant-1",
      fleetManager: fleet,
      getGithubToken: async () => "ghp_test",
      dispatchTimeoutMs: 5000,
    });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("dispatches audit and returns parsed issues", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_SSE, { status: 200 }));

    const result = await service.audit("org/app", {
      categories: ["code_quality", "security", "test_coverage"],
    });

    expect(result.issues).toHaveLength(3);
    expect(result.issues[0].title).toBe("Extract auth middleware from server.ts");
    expect(result.issues[1].priority).toBe("critical");
    expect(result.categories).toEqual(["code_quality", "security", "test_coverage"]);

    // Verify prompt contains selected categories
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt).toContain("Code Quality Audit");
    expect(body.prompt).toContain("Security Audit");
    expect(body.prompt).toContain("Test Coverage Audit");
  });

  it("stores audit results as gaps", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_SSE, { status: 200 }));

    await service.audit("org/app", { categories: ["code_quality", "security", "test_coverage"] });

    // Should have stored gaps
    expect(db._store.repoGaps).toHaveLength(3);
    expect(db._store.repoGaps[0].capability).toBe("audit:code_quality");
    expect(db._store.repoGaps[1].capability).toBe("audit:security");
  });

  it("tears down runner on failure", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Error", { status: 500 }));

    await expect(
      service.audit("org/app", { categories: ["security"] }),
    ).rejects.toThrow("Dispatch failed");

    expect(fleet.teardown).toHaveBeenCalledWith("ctr-audit");
  });

  it("rejects empty categories", async () => {
    await expect(
      service.audit("org/app", { categories: [] }),
    ).rejects.toThrow("At least one audit category");
  });

  it("includes custom instructions in prompt", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_SSE, { status: 200 }));

    await service.audit("org/app", {
      categories: ["security"],
      customInstructions: "Focus on the auth module",
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt).toContain("Focus on the auth module");
  });
});
