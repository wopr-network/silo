import { describe, it, expect } from "vitest";
import { matchEventPattern } from "../../src/adapters/glob.js";

describe("matchEventPattern", () => {
  it("matches exact event type", () => {
    expect(matchEventPattern("entity.created", "entity.created")).toBe(true);
  });

  it("matches wildcard segment", () => {
    expect(matchEventPattern("entity.*", "entity.created")).toBe(true);
    expect(matchEventPattern("entity.*", "entity.transitioned")).toBe(true);
  });

  it("does not match different prefix", () => {
    expect(matchEventPattern("entity.*", "invocation.created")).toBe(false);
  });

  it("does not match extra segments", () => {
    expect(matchEventPattern("entity.*", "entity.created.extra")).toBe(false);
  });

  it("does not match fewer segments", () => {
    expect(matchEventPattern("entity.*", "entity")).toBe(false);
  });

  it("matches full wildcard", () => {
    expect(matchEventPattern("*", "entity")).toBe(true);
    expect(matchEventPattern("*.*", "entity.created")).toBe(true);
  });

  it("handles multiple wildcards", () => {
    expect(matchEventPattern("*.*", "invocation.failed")).toBe(true);
  });
});
