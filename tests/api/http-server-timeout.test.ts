import { describe, expect, it } from "vitest";
import { startHonoServer } from "../../src/api/hono-server.js";

describe("HTTP server timeout configuration", () => {
  it("should set hardened timeouts on the underlying http.Server", () => {
    const engine = {} as any;
    const mcpDeps = {
      entities: {},
      flows: { listAll: async () => [] },
      invocations: {},
      gates: {},
      transitions: {},
      eventRepo: {},
      engine: null,
    } as any;

    const { server, close } = startHonoServer({ engine, mcpDeps }, 0, "127.0.0.1");

    try {
      // Global defaults protect all routes from Slowloris/DoS.
      expect(server.requestTimeout).toBe(30000);
      expect(server.headersTimeout).toBe(10000);
    } finally {
      close();
    }
  });
});
