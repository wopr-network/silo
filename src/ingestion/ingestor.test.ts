import { describe, expect, it, vi } from "vitest";
import type { IEntityMapRepository } from "../radar-db/repos/entity-map-repo.js";
import type { SiloClient } from "../silo-client/client.js";
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

function makeSiloClient(overrides: Partial<Record<string, unknown>> = {}): SiloClient {
  return {
    createEntity: vi.fn().mockResolvedValue({ id: "entity-001" }),
    report: vi.fn().mockResolvedValue({ next_action: "continue", new_state: "working", prompt: null, context: null }),
    claim: vi.fn().mockResolvedValue({ retry_after_ms: 50 }),
    ...overrides,
  } as unknown as SiloClient;
}

describe("Ingestor", () => {
  describe("ingest() — type: new", () => {
    it("creates entity, updates sentinel, and fires signal", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "new",
        flowName: "engineering",
        signal: "start",
        payload: { title: "Fix bug" },
      });

      expect(repo.insertIfAbsent).toHaveBeenCalledWith("linear", "WOP-100", "__pending__");
      expect(silo.createEntity).toHaveBeenCalledWith({
        flowName: "engineering",
        payload: { title: "Fix bug" },
      });
      expect(repo.updateEntityId).toHaveBeenCalledWith("linear", "WOP-100", "entity-001");
      expect(silo.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "start",
        artifacts: {},
      });
    });

    it("skips silo.report when signal is not provided", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-101",
        type: "new",
        flowName: "engineering",
      });

      expect(silo.createEntity).toHaveBeenCalled();
      expect(repo.updateEntityId).toHaveBeenCalledWith("linear", "WOP-101", "entity-001");
      expect(silo.report).not.toHaveBeenCalled();
    });

    it("omits payload from createEntity when not provided", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-102",
        type: "new",
        flowName: "engineering",
        signal: "start",
      });

      expect(silo.createEntity).toHaveBeenCalledWith({
        flowName: "engineering",
      });
    });
  });

  describe("ingest() — validation", () => {
    it("rejects payload missing sourceId", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(ingestor.ingest({ externalId: "X", type: "new", flowName: "eng" })).rejects.toThrow();

      expect(repo.insertIfAbsent).not.toHaveBeenCalled();
    });

    it("rejects payload missing externalId", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(ingestor.ingest({ sourceId: "linear", type: "new", flowName: "eng" })).rejects.toThrow();
    });

    it("rejects payload missing type", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(ingestor.ingest({ sourceId: "linear", externalId: "X", flowName: "eng" })).rejects.toThrow();
    });

    it("rejects payload missing flowName", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(ingestor.ingest({ sourceId: "linear", externalId: "X", type: "new" })).rejects.toThrow();
    });

    it("rejects payload with invalid type value", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(
        ingestor.ingest({
          sourceId: "linear",
          externalId: "X",
          type: "delete",
          flowName: "eng",
        }),
      ).rejects.toThrow();
    });

    it("rejects empty string sourceId", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(
        ingestor.ingest({
          sourceId: "",
          externalId: "X",
          type: "new",
          flowName: "eng",
        }),
      ).rejects.toThrow();
    });

    it("rejects non-object input", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(ingestor.ingest("not an object")).rejects.toThrow();
      await expect(ingestor.ingest(null)).rejects.toThrow();
      await expect(ingestor.ingest(42)).rejects.toThrow();
    });
  });

  describe("ingest() — duplicate handling", () => {
    it("silently skips when insertIfAbsent returns false (lost race)", async () => {
      const repo = makeEntityMapRepo({ insertIfAbsent: vi.fn().mockResolvedValue(false) });
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "new",
        flowName: "engineering",
        signal: "start",
      });

      expect(silo.createEntity).not.toHaveBeenCalled();
      expect(silo.report).not.toHaveBeenCalled();
      expect(repo.updateEntityId).not.toHaveBeenCalled();
    });
  });

  describe("ingest() — error handling", () => {
    it("cleans up sentinel and re-throws when createEntity fails", async () => {
      const repo = makeEntityMapRepo();
      const silo = makeSiloClient({
        createEntity: vi.fn().mockRejectedValue(new Error("entity create failed: 400")),
      });
      const ingestor = new Ingestor(repo, silo);

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
      expect(silo.report).not.toHaveBeenCalled();
    });
  });

  describe("ingest() — type: update", () => {
    it("reports signal with payload to existing entity", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue("entity-001"),
      });
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "update",
        flowName: "engineering",
        signal: "review_passed",
        payload: { approved: true },
      });

      expect(repo.findEntityId).toHaveBeenCalledWith("linear", "WOP-100");
      expect(silo.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "review_passed",
        artifacts: { approved: true },
      });
    });

    it("uses 'update' as default signal when signal is not provided", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue("entity-001"),
      });
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-100",
        type: "update",
        flowName: "engineering",
      });

      expect(silo.report).toHaveBeenCalledWith({
        entityId: "entity-001",
        signal: "update",
        artifacts: {},
      });
    });

    it("silently skips when entity is not found", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue(undefined),
      });
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await ingestor.ingest({
        sourceId: "linear",
        externalId: "WOP-999",
        type: "update",
        flowName: "engineering",
        signal: "review_passed",
      });

      expect(silo.report).not.toHaveBeenCalled();
    });

    it("throws when entity is still pending creation", async () => {
      const repo = makeEntityMapRepo({
        findEntityId: vi.fn().mockResolvedValue("__pending__"),
      });
      const silo = makeSiloClient();
      const ingestor = new Ingestor(repo, silo);

      await expect(
        ingestor.ingest({
          sourceId: "linear",
          externalId: "WOP-100",
          type: "update",
          flowName: "engineering",
          signal: "review_passed",
        }),
      ).rejects.toThrow("still being created");

      expect(silo.report).not.toHaveBeenCalled();
    });
  });
});
