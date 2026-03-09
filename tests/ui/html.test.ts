import { describe, expect, it } from "vitest";
import { UI_HTML } from "../../src/ui/index.html.js";

describe("UI_HTML", () => {
  it("exports a non-empty HTML string", () => {
    expect(typeof UI_HTML).toBe("string");
    expect(UI_HTML.length).toBeGreaterThan(100);
    expect(UI_HTML).toContain("<!DOCTYPE html>");
    expect(UI_HTML).toContain("DEFCON");
  });

  it("contains the four view sections", () => {
    expect(UI_HTML).toContain("entity-timeline");
    expect(UI_HTML).toContain("flow-graph");
    expect(UI_HTML).toContain("worker-dashboard");
    expect(UI_HTML).toContain("event-log");
  });
});
