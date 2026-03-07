import { describe, expect, it } from "vitest";
import {
  AdminFlowCreateSchema,
  AdminStateCreateSchema,
  AdminStateUpdateSchema,
} from "../../src/execution/admin-schemas.js";
import { getHandlebars, validateTemplate } from "../../src/engine/handlebars.js";

describe("Handlebars sandbox", () => {
  it("blocks prototype access via __proto__", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{__proto__.constructor}}");
    expect(() => tpl({ name: "test" })).toThrow();
  });

  it("blocks constructor access", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{constructor.name}}");
    expect(() => tpl({ name: "test" })).toThrow();
  });

  it("throws on missing variables in strict mode", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{nonexistent}}");
    expect(() => tpl({})).toThrow();
  });

  it("still renders valid templates normally", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("Hello {{name}}");
    expect(tpl({ name: "world" })).toBe("Hello world");
  });

  it("still allows built-in helpers", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{gt a b}}");
    expect(tpl({ a: 10, b: 5 })).toBe("true");
  });

  it("still allows #if blocks", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{#if show}}yes{{/if}}");
    expect(tpl({ show: true })).toBe("yes");
  });
});

describe("validateTemplate", () => {
  it("accepts safe templates", () => {
    expect(validateTemplate("Hello {{name}}")).toBe(true);
    expect(validateTemplate("{{gt count 5}}")).toBe(true);
    expect(validateTemplate('{{#if (eq status "active")}}yes{{/if}}')).toBe(true);
  });

  it("rejects templates with lookup helper", () => {
    expect(validateTemplate("{{lookup obj key}}")).toBe(false);
  });

  it("rejects templates with @root", () => {
    expect(validateTemplate("{{@root.constructor}}")).toBe(false);
  });

  it("rejects templates with __proto__", () => {
    expect(validateTemplate("{{__proto__}}")).toBe(false);
  });

  it("rejects templates with constructor", () => {
    expect(validateTemplate("{{constructor}}")).toBe(false);
  });

  it("rejects templates with __defineGetter__", () => {
    expect(validateTemplate("{{__defineGetter__}}")).toBe(false);
  });
});

describe("admin schema template validation", () => {
  it("rejects state creation with unsafe promptTemplate", () => {
    const result = AdminStateCreateSchema.safeParse({
      flow_name: "test",
      name: "open",
      promptTemplate: "{{constructor.name}}",
    });
    expect(result.success).toBe(false);
  });

  it("accepts state creation with safe promptTemplate", () => {
    const result = AdminStateCreateSchema.safeParse({
      flow_name: "test",
      name: "open",
      promptTemplate: "Hello {{entity.name}}",
    });
    expect(result.success).toBe(true);
  });

  it("rejects inline state with unsafe promptTemplate in flow creation", () => {
    const result = AdminFlowCreateSchema.safeParse({
      name: "test",
      initialState: "open",
      states: [{ name: "open", promptTemplate: "{{lookup obj key}}" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects state update with unsafe promptTemplate", () => {
    const result = AdminStateUpdateSchema.safeParse({
      flow_name: "test",
      state_name: "open",
      promptTemplate: "{{@root.constructor}}",
    });
    expect(result.success).toBe(false);
  });
});
