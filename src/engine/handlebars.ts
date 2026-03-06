import Handlebars from "handlebars";

const hbs = Handlebars.create();

hbs.registerHelper("gt", (a: number, b: number) => (a > b ? "true" : ""));
hbs.registerHelper("lt", (a: number, b: number) => (a < b ? "true" : ""));
hbs.registerHelper("eq", (a: unknown, b: unknown) => (String(a) === String(b) ? "true" : ""));

hbs.registerHelper("invocation_count", (entity: { invocations?: { stage: string }[] }, stage: string) =>
  String(entity.invocations?.filter((i) => i.stage === stage).length ?? 0),
);

hbs.registerHelper(
  "gate_passed",
  (entity: { gateResults?: { gateId: string; passed: boolean }[] }, gateName: string) =>
    (entity.gateResults?.some((g) => g.gateId === gateName && g.passed) ?? false) ? "true" : "",
);

hbs.registerHelper("has_artifact", (entity: { artifacts?: Record<string, unknown> }, key: string) =>
  entity.artifacts?.[key] !== undefined ? "true" : "",
);

hbs.registerHelper("time_in_state", (entity: { updatedAt: string | Date }) =>
  String(Date.now() - new Date(entity.updatedAt).getTime()),
);

/** Get the shared Handlebars instance with all built-in helpers. */
export function getHandlebars(): typeof hbs {
  return hbs;
}

/** Register a custom helper on the shared instance. */
export function registerHelper(name: string, fn: (...args: unknown[]) => unknown): void {
  hbs.registerHelper(name, fn);
}
