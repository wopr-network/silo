import { describe, expect, it } from "vitest";
import { resolveCorsOrigin } from "../src/cors.js";

describe("resolveCorsOrigin", () => {
  it("returns null for loopback 127.0.0.1 (no restriction needed)", () => {
    expect(resolveCorsOrigin({ host: "127.0.0.1", corsEnv: undefined })).toEqual({ origins: null });
  });

  it("returns null for loopback localhost", () => {
    expect(resolveCorsOrigin({ host: "localhost", corsEnv: undefined })).toEqual({ origins: null });
  });

  it("returns null for loopback ::1", () => {
    expect(resolveCorsOrigin({ host: "::1", corsEnv: undefined })).toEqual({ origins: null });
  });

  it("throws for non-loopback without SILO_CORS_ORIGIN", () => {
    expect(() => resolveCorsOrigin({ host: "0.0.0.0", corsEnv: undefined })).toThrow("SILO_CORS_ORIGIN");
  });

  it("throws for non-loopback with empty SILO_CORS_ORIGIN", () => {
    expect(() => resolveCorsOrigin({ host: "192.168.1.5", corsEnv: "" })).toThrow("SILO_CORS_ORIGIN");
  });

  it("returns single origin as array for non-loopback with SILO_CORS_ORIGIN set", () => {
    expect(resolveCorsOrigin({ host: "0.0.0.0", corsEnv: "https://my-app.example.com" })).toEqual({
      origins: ["https://my-app.example.com"],
    });
  });

  it("returns single origin as array for loopback with SILO_CORS_ORIGIN set (explicit override)", () => {
    expect(resolveCorsOrigin({ host: "127.0.0.1", corsEnv: "https://my-app.example.com" })).toEqual({
      origins: ["https://my-app.example.com"],
    });
  });

  it("returns multiple origins as array for comma-separated SILO_CORS_ORIGIN", () => {
    expect(
      resolveCorsOrigin({ host: "0.0.0.0", corsEnv: "https://app.example.com,http://localhost:3000" }),
    ).toEqual({ origins: ["https://app.example.com", "http://localhost:3000"] });
  });

  it("trims whitespace around comma-separated origins", () => {
    expect(
      resolveCorsOrigin({ host: "0.0.0.0", corsEnv: "https://app.example.com , http://localhost:3000" }),
    ).toEqual({ origins: ["https://app.example.com", "http://localhost:3000"] });
  });

  it("throws if any origin in a comma-separated list is invalid", () => {
    expect(() =>
      resolveCorsOrigin({ host: "0.0.0.0", corsEnv: "https://valid.example.com,not-an-origin" }),
    ).toThrow("not-an-origin");
  });
});
