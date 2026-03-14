import { describe, expect, it } from "vitest";
import { errorResult, jsonResult, validateInput } from "./mcp-helpers.js";

describe("errorResult", () => {
  it("returns isError true with message", () => {
    const result = errorResult("something broke");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("something broke");
  });

  it("includes errorCode when provided", () => {
    const result = errorResult("Entity not found: abc", "NOT_FOUND");
    expect(result.errorCode).toBe("NOT_FOUND");
  });

  it("omits errorCode when not provided", () => {
    const result = errorResult("generic error");
    expect(result.errorCode).toBeUndefined();
  });
});

describe("jsonResult", () => {
  it("returns JSON-stringified content", () => {
    const result = jsonResult({ foo: "bar" });
    expect(result.content[0].text).toBe('{"foo":"bar"}');
    expect((result as Record<string, unknown>).isError).toBeUndefined();
  });
});

describe("validateInput", () => {
  it("returns ok:true with parsed data on success", () => {
    const schema = {
      safeParse: (data: unknown) => ({ success: true as const, data: data as { name: string } }),
    };
    const result = validateInput(schema, { name: "test" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: "test" });
    }
  });

  it("returns ok:false with errorResult on failure", () => {
    const schema = {
      safeParse: (_data: unknown) => ({
        success: false as const,
        error: { issues: [{ message: "required" }] },
      }),
    };
    const result = validateInput(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.isError).toBe(true);
    }
  });
});
