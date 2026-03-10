import { describe, expect, it } from "vitest";
import { isLitestreamEnabled, LitestreamManager } from "./manager.js";

describe("isLitestreamEnabled", () => {
  it("returns false when SILO_LITESTREAM_REPLICA_URL is not set", () => {
    delete process.env.SILO_LITESTREAM_REPLICA_URL;
    expect(isLitestreamEnabled()).toBe(false);
  });

  it("returns true when SILO_LITESTREAM_REPLICA_URL is set", () => {
    process.env.SILO_LITESTREAM_REPLICA_URL = "s3://bucket/silo.db";
    expect(isLitestreamEnabled()).toBe(true);
    delete process.env.SILO_LITESTREAM_REPLICA_URL;
  });
});

describe("LitestreamManager", () => {
  it("generates correct YAML config", () => {
    const mgr = new LitestreamManager({
      dbPath: "/data/silo.db",
      replicaUrl: "s3://bucket/silo.db",
      accessKeyId: "AKIA...",
      secretAccessKey: "secret",
      region: "us-east-1",
      retention: "24h",
      syncInterval: "1s",
    });
    const yaml = mgr.generateConfig();
    expect(yaml).toContain("'/data/silo.db'");
    expect(yaml).toContain("'s3://bucket/silo.db'");
    expect(yaml).not.toContain("AKIA...");
    expect(yaml).toContain("retention: '24h'");
    expect(yaml).toContain("sync-interval: '1s'");
  });

  it("generates config with custom endpoint for R2", () => {
    const mgr = new LitestreamManager({
      dbPath: "/data/silo.db",
      replicaUrl: "s3://bucket/silo.db",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpoint: "https://account.r2.cloudflarestorage.com",
      region: "auto",
      retention: "24h",
      syncInterval: "1s",
    });
    const yaml = mgr.generateConfig();
    expect(yaml).toContain("endpoint: 'https://account.r2.cloudflarestorage.com'");
  });
});
