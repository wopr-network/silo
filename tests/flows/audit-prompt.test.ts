import { describe, expect, it } from "vitest";
import { parseAuditOutput, renderAuditPrompt } from "../../src/flows/audit-prompt.js";

describe("renderAuditPrompt", () => {
  it("renders selected categories into prompt", () => {
    const prompt = renderAuditPrompt("org/app", {
      categories: ["code_quality", "security"],
    });

    expect(prompt).toContain("org/app");
    expect(prompt).toContain("Code Quality Audit");
    expect(prompt).toContain("Security Audit");
    expect(prompt).not.toContain("Test Coverage Audit");
    expect(prompt).not.toContain("Dependency Audit");
  });

  it("includes all categories when all selected", () => {
    const prompt = renderAuditPrompt("org/app", {
      categories: ["code_quality", "security", "test_coverage", "dependencies", "tech_debt"],
    });

    expect(prompt).toContain("Code Quality Audit");
    expect(prompt).toContain("Security Audit");
    expect(prompt).toContain("Test Coverage Audit");
    expect(prompt).toContain("Dependency Audit");
    expect(prompt).toContain("Tech Debt Audit");
  });

  it("includes custom instructions", () => {
    const prompt = renderAuditPrompt("org/app", {
      categories: ["security"],
      customInstructions: "Focus on the auth module — it was recently rewritten.",
    });

    expect(prompt).toContain("Additional Instructions");
    expect(prompt).toContain("Focus on the auth module");
  });

  it("omits custom instructions block when not provided", () => {
    const prompt = renderAuditPrompt("org/app", { categories: ["code_quality"] });
    expect(prompt).not.toContain("Additional Instructions");
  });
});

describe("parseAuditOutput", () => {
  it("parses multiple issues", () => {
    const output = `Some analysis text.

ISSUE:{"category":"code_quality","title":"Extract auth middleware","priority":"medium","file":"src/server.ts","line":145,"description":"server.ts is too large."}
ISSUE:{"category":"security","title":"Fix command injection","priority":"critical","file":"src/deploy.ts","line":34,"description":"exec() with unsanitized input."}

More analysis.

ISSUE:{"category":"test_coverage","title":"Add tests for user service","priority":"high","file":"src/services/user.ts","description":"No test file exists."}

audit_complete`;

    const issues = parseAuditOutput(output);

    expect(issues).toHaveLength(3);
    expect(issues[0].category).toBe("code_quality");
    expect(issues[0].title).toBe("Extract auth middleware");
    expect(issues[0].line).toBe(145);
    expect(issues[1].category).toBe("security");
    expect(issues[1].priority).toBe("critical");
    expect(issues[2].file).toBe("src/services/user.ts");
    expect(issues[2].line).toBeUndefined();
  });

  it("returns empty array for no issues", () => {
    const output = "Scanned the repo. Everything looks clean.\n\naudit_complete";
    expect(parseAuditOutput(output)).toHaveLength(0);
  });

  it("skips malformed JSON lines", () => {
    const output = `ISSUE:{"category":"code_quality","title":"Good one","priority":"high","file":"x.ts","description":"ok"}
ISSUE:not json at all
ISSUE:{"category":"security","title":"Also good","priority":"low","file":"y.ts","description":"fine"}`;

    const issues = parseAuditOutput(output);
    expect(issues).toHaveLength(2);
  });

  it("skips issues missing required fields", () => {
    const output = `ISSUE:{"title":"No category","priority":"high","file":"x.ts","description":"missing category field"}
ISSUE:{"category":"security","priority":"high","file":"x.ts","description":"missing title"}
ISSUE:{"category":"security","title":"Valid","priority":"high","file":"x.ts","description":"this one is fine"}`;

    const issues = parseAuditOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Valid");
  });
});
