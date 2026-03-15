import { describe, expect, it, vi } from "vitest";
import type { HolyshipClient } from "../holyship-client/client.js";
import type { IEntityMapRepository } from "./ingestor.js";
import { Ingestor } from "./ingestor.js";

function makeEntityMapRepo(overrides: Partial<Record<keyof IEntityMapRepository, unknown>> = {}): IEntityMapRepository {
  return {
    findEntityId: vi.fn().mockResolvedValue(undefined),
    insertIfAbsent: vi.fn().mockResolvedValue(true),
    updateEntityId: vi.fn().mockResolvedValue(undefined),
    deleteRow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IEntityMapRepository;
}

function makeHolyshipClient(overrides: Partial<Record<keyof HolyshipClient, unknown>> = {}): HolyshipClient {
  return {
    createEntity: vi.fn().mockResolvedValue({ id: "entity-001" }),
    report: vi.fn().mockResolvedValue({ next_action: "continue", new_state: "working", prompt: null, context: null }),
    claim: vi.fn().mockResolvedValue({ retry_after_ms: 50 }),
    ...overrides,
  } as unknown as HolyshipClient;
}

describe("Ingestor", () => {
  describe("ingest() — type: new", () => {
    it("creates entity, updates sentinel, and fires signal", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "new",
        flowName: "engineering",
        signal: "start",
        payload: { title: "Fix bug" },
      });

      expect(repo.insertIfAbsent).toHaveBeenCalledWith("linear", "WOP-100", "__pending__");
      expect(holyship.createEntity).toHaveBeenCalledWith({
        flowName: "engineering",
        payload: { title: "Fix bug" },
      });
      expect(repo.updateEntityId).toHaveBeenCalledWith("linear", "WOP-100", "entity-001");
      expect(holyship.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "start",
        artifacts: {},
      });
    });

    it("skips holyship.report when signal is not provided", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-101",
        type: "new",
        flowName: "engineering",
      });

      expect(holyship.createEntity).toHaveBeenCalled();
      expect(repo.updateEntityId).toHaveBeenCalledWith("linear", "WOP-101", "entity-001");
      expect(holyship.report).not.toHaveBeenCalled();
    });

    it("omits payload from createEntity when not provided", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-102",
        type: "new",
        flowName: "engineering",
        signal: "start",
      });

      expect(holyship.createEntity).toHaveBeenCalledWith({
        flowName: "engineering",
      });
    });
  });

  describe("ingest() — validation", () => {
    it("rejects payload missing sourceId", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(ingestor.ingest({ externalId: "X", type: "new", flowName: "eng" })).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects payload missing externalId", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(ingestor.ingest({ sourceId: "linear", type: "new", flowName: "eng" })).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects payload missing type", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(ingestor.ingest({ sourceId: "linear", externalId: "X", flowName: "eng" })).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects payload missing flowName", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(ingestor.ingest({ sourceId: "linear", externalId: "X", type: "new" })).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects payload with invalid type value", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(
        ingestor.ingest({
          sourceId: "linear",
          externalId: "X",
          type: "delete",
          flowName: "eng",
        }),
      ).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects empty string sourceId", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(
        ingestor.ingest({
          sourceId: "",
          externalId: "X",
          type: "new",
          flowName: "eng",
        }),
      ).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects non-object input", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(ingestor.ingest("not an object")).rejects.toThrow();
      await expect(ingestor.ingest(null)).rejects.toThrow();
      await expect(ingestor.ingest(42)).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe("ingest() — duplicate handling", () => {
    it("silently skips when insertIfAbsent returns false (lost race)", async () => {
      const repo = makeEntityMapRepo({ insertIfAbsent: vi.fn().mockResolvedValue(false) });
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "new",
        flowName: "engineering",
        signal: "start",
      });

      expect(holyship.createEntity).not.toHaveBeenCalled();
      expect(holyship.report).not.toHaveBeenCalled();
      expect(repo.updateEntityId).not.toHaveBeenCalled();
    });
  });

  describe("ingest() — error handling", () => {
    it("re-throws when updateEntityId succeeds but holyship.report fails", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient({
        report: vi.fn().mockRejectedValue(new Error("flow.report failed: 503")),
      });
      const ingestor = new Ingestor(repo, holyship);

      await expect(
        ingestor.ingest({
          sourceId: "linear",
          externalId: "WOP-100",
          type: "new",
          flowName: "engineering",
          signal: "start",
        }),
      ).rejects.toThrow("flow.report failed: 503");

      expect(repo.updateEntityId).toHaveBeenCalledWith("linear", "WOP-100", "entity-001");
      expect(holyship.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "start",
        artifacts: {},
      });
    });

    it("cleans up sentinel and re-throws when createEntity fails", async () => {
      const repo = makeEntityMapRepo();
      const holyship = makeHolyshipClient({
        createEntity: vi.fn().mockRejectedValue(new Error("entity create failed: 400")),
      });
      const ingestor = new Ingestor(repo, holyship);

      await expect(
        ingestor.ingest({
          sourceId: "linear",
          externalId: "WOP-100",
          type: "new",
          flowName: "bad-flow",
          signal: "start",
        }),
      ).rejects.toThrow("entity create failed: 400");

      expect(repo.insertIfAbsent).toHaveBeenCalledWith("linear", "WOP-100", "__pending__");
      expect(repo.deleteRow).toHaveBeenCalledWith("linear", "WOP-100");
      expect(repo.updateEntityId).not.toHaveBeenCalled();
      expect(holyship.report).not.toHaveBeenCalled();
    });
  });

  describe("ingest() — type: update", () => {
    it("reports signal with payload to existing entity", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue("entity-001"),
      });
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "update",
        flowName: "engineering",
        signal: "review_passed",
        payload: { approved: true },
      });

      expect(repo.findEntityId).toHaveBeenCalledWith("linear", "WOP-100");
      expect(holyship.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "review_passed",
        artifacts: { approved: true },
      });
    });

    it("uses 'update' as default signal when signal is not provided", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue("entity-001"),
      });
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "update",
        flowName: "engineering",
      });

      expect(holyship.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "update",
        artifacts: {},
      });
    });

    it("silently skips when entity is not found", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue(undefined),
      });
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-999",
        type: "update",
        flowName: "engineering",
        signal: "review_passed",
      });

      expect(holyship.report).not.toHaveBeenCalled();
    });

    it("throws when entity is still pending creation", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue("__pending__"),
      });
      const holyship = makeHolyshipClient();
      const ingestor = new Ingestor(repo, holyship);

      await expect(
        ingestor.ingest({
          sourceId: "linear",
          externalId: "WOP-100",
          type: "update",
          flowName: "engineering",
          signal: "review_passed",
        }),
      ).rejects.toThrow("still being created");

      expect(holyship.report).not.toHaveBeenCalled();
    });
  });
});
