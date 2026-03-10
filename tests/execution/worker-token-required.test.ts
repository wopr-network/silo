import { describe, expect, it } from "vitest";
import { validateWorkerToken } from "../../src/execution/cli.js";

describe("validateWorkerToken", () => {
  it("throws when HTTP is active and no worker token is set", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: true, transport: "stdio" }),
    ).toThrow("SILO_WORKER_TOKEN");
  });

  it("throws when SSE transport is active and no worker token is set", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: false, transport: "sse" }),
    ).toThrow("SILO_WORKER_TOKEN");
  });

  it("does not throw when stdio-only (no HTTP, no SSE)", () => {
    expect(() =>
      validateWorkerToken({ workerToken: undefined, startHttp: false, transport: "stdio" }),
    ).not.toThrow();
  });

  it("does not throw when worker token is set with HTTP", () => {
    expect(() =>
      validateWorkerToken({ workerToken: "my-secret", startHttp: true, transport: "stdio" }),
    ).not.toThrow();
  });

  it("treats empty string worker token as unset (throws for HTTP)", () => {
    expect(() =>
      validateWorkerToken({ workerToken: "", startHttp: true, transport: "stdio" }),
    ).toThrow("SILO_WORKER_TOKEN");
  });
});
