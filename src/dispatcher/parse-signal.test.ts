import { describe, expect, it } from "vitest";
import { parseArtifacts, parseSignal } from "./parse-signal.js";

describe("parseSignal", () => {
  it("extracts spec_ready signal", () => {
    const output = "Some preamble\nSpec ready: WOP-1934\nDone.";
    const result = parseSignal(output);
    expect(result.signal).toBe("spec_ready");
    expect(result.artifacts).toEqual({ issueKey: "WOP-1934" });
  });

  it("extracts pr_created signal with URL and number", () => {
    const output = "PR created: https://github.com/wopr-network/radar/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("pr_created");
    expect(result.artifacts).toEqual({
      prUrl: "https://github.com/wopr-network/radar/pull/42",
      prNumber: 42,
    });
  });

  it("extracts clean signal", () => {
    const output = "CLEAN: https://github.com/wopr-network/radar/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("clean");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/radar/pull/42",
    });
  });

  it("extracts issues signal with findings", () => {
    const output = "ISSUES: https://github.com/wopr-network/radar/pull/42 — unused import; missing test";
    const result = parseSignal(output);
    expect(result.signal).toBe("issues");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/radar/pull/42",
      reviewFindings: ["unused import", "missing test"],
    });
  });

  it("extracts fixes_pushed signal", () => {
    const output = "Fixes pushed: https://github.com/wopr-network/radar/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("fixes_pushed");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/radar/pull/42",
    });
  });

  it("extracts merged signal", () => {
    const output = "Merged: https://github.com/wopr-network/radar/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("merged");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/radar/pull/42",
    });
  });

  it("extracts start signal", () => {
    const output = "start";
    const result = parseSignal(output);
    expect(result.signal).toBe("start");
    expect(result.artifacts).toEqual({});
  });

  it("extracts design_needed signal", () => {
    const output = "design_needed";
    const result = parseSignal(output);
    expect(result.signal).toBe("design_needed");
    expect(result.artifacts).toEqual({});
  });

  it("does not match design_needed mid-line", () => {
    const output = "Architect says design_needed for this issue";
    const result = parseSignal(output);
    expect(result.signal).toBe("unknown");
  });

  it("extracts design_ready signal", () => {
    const output = "design_ready";
    const result = parseSignal(output);
    expect(result.signal).toBe("design_ready");
    expect(result.artifacts).toEqual({});
  });

  it("extracts cant_resolve signal", () => {
    const output = "cant_resolve";
    const result = parseSignal(output);
    expect(result.signal).toBe("cant_resolve");
    expect(result.artifacts).toEqual({});
  });

  it("returns unknown when no signal found", () => {
    const output = "Just some random output\nnothing here";
    const result = parseSignal(output);
    expect(result.signal).toBe("unknown");
    expect(result.artifacts).toEqual({});
  });

  it("picks the last signal when multiple are present", () => {
    const output = "Spec ready: WOP-100\nMerged: https://github.com/org/repo/pull/5";
    const result = parseSignal(output);
    expect(result.signal).toBe("merged");
  });
});

describe("parseArtifacts", () => {
  it("extracts artifacts from HTML comment block", () => {
    const output = [
      "Some preamble text",
      '<!-- ARTIFACTS: {"reviewCommentId":"abc-123","reviewFindings":["unused import"]} -->',
      "ISSUES: https://github.com/org/repo/pull/5 — unused import",
    ].join("\n");
    const result = parseArtifacts(output);
    expect(result).toEqual({
      reviewCommentId: "abc-123",
      reviewFindings: ["unused import"],
    });
  });

  it("returns empty object when no artifacts block present", () => {
    const output = "PR created: https://github.com/org/repo/pull/5";
    expect(parseArtifacts(output)).toEqual({});
  });

  it("returns empty object when JSON is malformed", () => {
    const output = "<!-- ARTIFACTS: {bad json} -->";
    expect(parseArtifacts(output)).toEqual({});
  });

  it("picks the last artifacts block when multiple are present", () => {
    const output = ['<!-- ARTIFACTS: {"a":1} -->', '<!-- ARTIFACTS: {"b":2} -->'].join("\n");
    expect(parseArtifacts(output)).toEqual({ b: 2 });
  });

  it("handles whitespace around the JSON", () => {
    const output = '<!-- ARTIFACTS:   {"key": "value"}   -->';
    expect(parseArtifacts(output)).toEqual({ key: "value" });
  });
});
