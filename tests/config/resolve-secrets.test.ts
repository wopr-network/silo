import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfigSecrets } from "../../src/config/resolve-secrets.js";

describe("resolveConfigSecrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null for null config", () => {
    expect(resolveConfigSecrets(null)).toBeNull();
  });

  it("passes through config with no env references", () => {
    const config = { host: "localhost", port: 3000 };
    expect(resolveConfigSecrets(config)).toEqual({ host: "localhost", port: 3000 });
  });

  it("resolves top-level ${VAR} references", () => {
    vi.stubEnv("MY_API_KEY", "secret-123");
    const config = { apiKey: "${MY_API_KEY}", name: "test" };
    const result = resolveConfigSecrets(config);
    expect(result).toEqual({ apiKey: "secret-123", name: "test" });
  });

  it("resolves nested object string values", () => {
    vi.stubEnv("DISCORD_TOKEN", "bot-token-abc");
    const config = {
      token: "${DISCORD_TOKEN}",
      routes: { "entity.created": { channel: "123" } },
    };
    const result = resolveConfigSecrets(config);
    expect(result).toEqual({
      token: "bot-token-abc",
      routes: { "entity.created": { channel: "123" } },
    });
  });

  it("throws when referenced env var is not set", () => {
    const config = { apiKey: "${MISSING_VAR}" };
    expect(() => resolveConfigSecrets(config)).toThrow(
      'Environment variable "MISSING_VAR" is not set (referenced in integration config)',
    );
  });

  it("resolves embedded env refs within a string", () => {
    vi.stubEnv("HOST", "api.example.com");
    const config = { url: "https://${HOST}/v1" };
    const result = resolveConfigSecrets(config);
    expect(result).toEqual({ url: "https://api.example.com/v1" });
  });

  it("preserves non-string values", () => {
    const config = { timeout: 5000, enabled: true, tags: ["a", "b"] };
    expect(resolveConfigSecrets(config)).toEqual(config);
  });
});
