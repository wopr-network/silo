import { describe, expect, it } from "vitest";
import {
  AdminFlowCreateSchema,
  AdminFlowUpdateSchema,
  AdminStateCreateSchema,
  AdminGateCreateSchema,
  AdminFlowRestoreSchema,
} from "../src/execution/admin-schemas.js";

describe("admin-schemas", () => {
  it("AdminFlowCreateSchema accepts valid input", () => {
    const result = AdminFlowCreateSchema.safeParse({
      name: "ci-pipeline",
      initialState: "open",
    });
    expect(result.success).toBe(true);
  });

  it("AdminFlowCreateSchema rejects missing name", () => {
    const result = AdminFlowCreateSchema.safeParse({ initialState: "open" });
    expect(result.success).toBe(false);
  });

  it("AdminFlowUpdateSchema accepts valid input", () => {
    const result = AdminFlowUpdateSchema.safeParse({
      flow_name: "ci-pipeline",
      description: "Updated description",
    });
    expect(result.success).toBe(true);
  });

  it("AdminStateCreateSchema accepts valid input", () => {
    const result = AdminStateCreateSchema.safeParse({
      flow_name: "ci-pipeline",
      name: "review",
      mode: "passive",
    });
    expect(result.success).toBe(true);
  });

  it("AdminGateCreateSchema accepts command gate", () => {
    const result = AdminGateCreateSchema.safeParse({
      name: "lint-check",
      type: "command",
      command: "./gates/lint-check.sh",
    });
    expect(result.success).toBe(true);
  });

  it("AdminGateCreateSchema rejects command gate without command", () => {
    const result = AdminGateCreateSchema.safeParse({
      name: "lint-check",
      type: "command",
    });
    expect(result.success).toBe(false);
  });

  it("AdminGateCreateSchema accepts function gate", () => {
    const result = AdminGateCreateSchema.safeParse({
      name: "fn-check",
      type: "function",
      functionRef: "myModule:check",
    });
    expect(result.success).toBe(true);
  });

  it("AdminGateCreateSchema accepts api gate", () => {
    const result = AdminGateCreateSchema.safeParse({
      name: "api-check",
      type: "api",
      apiConfig: { url: "https://example.com/check" },
    });
    expect(result.success).toBe(true);
  });

  it("AdminFlowRestoreSchema requires version >= 1", () => {
    const result = AdminFlowRestoreSchema.safeParse({
      flow_name: "ci-pipeline",
      version: 0,
    });
    expect(result.success).toBe(false);
  });

  it("AdminFlowRestoreSchema accepts version >= 1", () => {
    const result = AdminFlowRestoreSchema.safeParse({
      flow_name: "ci-pipeline",
      version: 1,
    });
    expect(result.success).toBe(true);
  });
});
