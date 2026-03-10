import { describe, expect, it } from "vitest";
import { safeErrorMessage, sanitizeErrorMessage } from "./sanitize.js";

describe("sanitizeErrorMessage", () => {
  it("strips Bearer tokens", () => {
    const msg = "request failed: Authorization: Bearer lin_api_abc123def456";
    expect(sanitizeErrorMessage(msg)).not.toContain("lin_api_abc123def456");
    expect(sanitizeErrorMessage(msg)).toContain("[REDACTED]");
  });

  it("strips lin_api_ keys", () => {
    const msg = "Error connecting with key lin_api_abcdefghijk";
    expect(sanitizeErrorMessage(msg)).not.toContain("lin_api_abcdefghijk");
  });

  it("strips GitHub tokens", () => {
    const msg = "Auth failed with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm";
    expect(sanitizeErrorMessage(msg)).not.toContain("ghp_ABCDEFGHIJ");
  });

  it("strips key=value credential patterns", () => {
    const msg = 'config: api_key="sk-ant-abc123xyz"';
    expect(sanitizeErrorMessage(msg)).not.toContain("sk-ant-abc123xyz");
  });

  it("passes through clean messages unchanged", () => {
    const msg = "Linear API error: 500";
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });
});

describe("case-insensitive bearer and basic auth redaction", () => {
  it("strips lowercase bearer tokens", () => {
    const msg = "failed: bearer token123abc";
    expect(sanitizeErrorMessage(msg)).not.toContain("token123abc");
    expect(sanitizeErrorMessage(msg)).toContain("[REDACTED]");
  });

  it("strips mixed-case bearer tokens", () => {
    const msg = "error: Bearer Token456";
    expect(sanitizeErrorMessage(msg)).not.toContain("Token456");
  });

  it("strips Basic auth headers", () => {
    const msg = "request failed: basic dXNlcjpwYXNzd29yZA==";
    expect(sanitizeErrorMessage(msg)).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(sanitizeErrorMessage(msg)).toContain("[REDACTED]");
  });

  it("strips uppercase BASIC auth headers", () => {
    const msg = "BASIC dXNlcjpwYXNzd29yZA==";
    expect(sanitizeErrorMessage(msg)).not.toContain("dXNlcjpwYXNzd29yZA==");
  });
});

describe("safeErrorMessage", () => {
  it("extracts message from Error objects", () => {
    const err = new Error("something failed");
    expect(safeErrorMessage(err)).toBe("something failed");
  });

  it("handles non-Error objects", () => {
    expect(safeErrorMessage("string error")).toBe("string error");
    expect(safeErrorMessage(42)).toBe("42");
    expect(safeErrorMessage(null)).toBe("unknown error");
    expect(safeErrorMessage(undefined)).toBe("unknown error");
  });

  it("sanitizes credentials in Error messages", () => {
    const err = new Error("failed with Bearer lin_api_secret123");
    expect(safeErrorMessage(err)).not.toContain("lin_api_secret123");
  });
});
