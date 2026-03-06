import { describe, expect, it } from "vitest";
import { getHandlebars, registerHelper } from "../../src/engine/handlebars.js";

describe("getHandlebars", () => {
  it("returns a Handlebars instance with built-in helpers", () => {
    const hbs = getHandlebars();
    expect(hbs).toBeDefined();
    expect(typeof hbs.compile).toBe("function");
  });

  it("returns the same instance on repeated calls", () => {
    expect(getHandlebars()).toBe(getHandlebars());
  });

  it("has gt helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{gt a b}}");
    expect(tpl({ a: 10, b: 5 })).toBe("true");
    expect(tpl({ a: 3, b: 5 })).toBe("");
  });

  it("has lt helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{lt a b}}");
    expect(tpl({ a: 3, b: 5 })).toBe("true");
    expect(tpl({ a: 10, b: 5 })).toBe("");
  });

  it("has eq helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{eq a b}}");
    expect(tpl({ a: "x", b: "x" })).toBe("true");
    expect(tpl({ a: "x", b: "y" })).toBe("");
  });

  it("has invocation_count helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile('{{invocation_count entity "review"}}');
    expect(tpl({ entity: { invocations: [{ stage: "review" }, { stage: "build" }] } })).toBe("1");
  });

  it("has gate_passed helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile('{{gate_passed entity "lint"}}');
    expect(tpl({ entity: { gateResults: [{ gateId: "lint", passed: true }] } })).toBe("true");
  });

  it("has has_artifact helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile('{{has_artifact entity "diff"}}');
    expect(tpl({ entity: { artifacts: { diff: "data" } } })).toBe("true");
  });

  it("has time_in_state helper registered", () => {
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{time_in_state entity}}");
    const result = tpl({ entity: { updatedAt: new Date(Date.now() - 5000).toISOString() } });
    expect(Number(result)).toBeGreaterThanOrEqual(4000);
  });
});

describe("registerHelper", () => {
  it("registers a custom helper on the shared instance", () => {
    registerHelper("double", (n: number) => String(n * 2));
    const hbs = getHandlebars();
    const tpl = hbs.compile("{{double val}}");
    expect(tpl({ val: 7 })).toBe("14");
  });
});
