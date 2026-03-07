import { describe, expect, it } from "vitest";
import { validateAdminToken } from "../../src/execution/cli.js";

describe("validateAdminToken", () => {
  it("throws when HTTP is active and no admin token is set", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: true, transport: "stdio" }),
    ).toThrow("DEFCON_ADMIN_TOKEN");
  });

  it("throws when SSE transport is active and no admin token is set", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: false, transport: "sse" }),
    ).toThrow("DEFCON_ADMIN_TOKEN");
  });

  it("throws when both HTTP and SSE are active and no admin token is set", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: true, transport: "sse" }),
    ).toThrow("DEFCON_ADMIN_TOKEN");
  });

  it("does not throw when stdio-only (no HTTP, no SSE)", () => {
    expect(() =>
      validateAdminToken({ adminToken: undefined, startHttp: false, transport: "stdio" }),
    ).not.toThrow();
  });

  it("does not throw when admin token is set with HTTP", () => {
    expect(() =>
      validateAdminToken({ adminToken: "my-secret", startHttp: true, transport: "stdio" }),
    ).not.toThrow();
  });

  it("does not throw when admin token is set with SSE", () => {
    expect(() =>
      validateAdminToken({ adminToken: "my-secret", startHttp: false, transport: "sse" }),
    ).not.toThrow();
  });

  it("treats empty string admin token as unset (throws for HTTP)", () => {
    // cli.ts converts "" to undefined via `|| undefined` before calling validateAdminToken,
    // but the function itself should also reject empty-string tokens from direct callers.
    expect(() =>
      validateAdminToken({ adminToken: "", startHttp: true, transport: "stdio" }),
    ).toThrow("DEFCON_ADMIN_TOKEN");
  });
});
