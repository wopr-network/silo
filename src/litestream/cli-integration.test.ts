import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConfigFromEnv } from "./manager.js";

describe("buildConfigFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("builds config from env vars with defaults", () => {
    process.env.SILO_LITESTREAM_REPLICA_URL = "s3://bucket/db";
    process.env.SILO_LITESTREAM_ACCESS_KEY_ID = "AKIA";
    process.env.SILO_LITESTREAM_SECRET_ACCESS_KEY = "secret";
    const config = buildConfigFromEnv("./silo.db");
    expect(config.replicaUrl).toBe("s3://bucket/db");
    expect(config.region).toBe("us-east-1");
    expect(config.retention).toBe("24h");
    expect(config.syncInterval).toBe("1s");
    expect(config.endpoint).toBeUndefined();
  });

  it("throws if access keys missing", () => {
    process.env.SILO_LITESTREAM_REPLICA_URL = "s3://bucket/db";
    delete process.env.SILO_LITESTREAM_ACCESS_KEY_ID;
    expect(() => buildConfigFromEnv("./silo.db")).toThrow("SILO_LITESTREAM_ACCESS_KEY_ID");
  });

  it("includes custom endpoint", () => {
    process.env.SILO_LITESTREAM_REPLICA_URL = "s3://bucket/db";
    process.env.SILO_LITESTREAM_ACCESS_KEY_ID = "AKIA";
    process.env.SILO_LITESTREAM_SECRET_ACCESS_KEY = "secret";
    process.env.SILO_LITESTREAM_ENDPOINT = "https://r2.example.com";
    const config = buildConfigFromEnv("./silo.db");
    expect(config.endpoint).toBe("https://r2.example.com");
  });
});
