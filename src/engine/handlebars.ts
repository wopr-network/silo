import Handlebars from "handlebars";

const hbs = Handlebars.create();

/** Compile options applied to every template for security.
 * noPrototypeAccess is a Handlebars 4.6+ runtime option not in @types/handlebars.
 */
const SAFE_COMPILE_OPTIONS = {
  noPrototypeAccess: true,
  strict: true,
} as CompileOptions;

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

const BUILTIN_HELPERS = new Set(["gt", "lt", "eq", "invocation_count", "gate_passed", "has_artifact", "time_in_state"]);

// Wrap compile to enforce safe options on every call
const originalCompile = hbs.compile.bind(hbs);
hbs.compile = ((template: string, options?: CompileOptions) => {
  return originalCompile(template, { ...options, ...SAFE_COMPILE_OPTIONS });
}) as typeof hbs.compile;

/** Forbidden patterns in templates — OWASP A03 Injection prevention. */
const UNSAFE_PATTERN =
  /\b(lookup|__proto__|constructor|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)\b|@root/;

/** Validate a template string against the safe subset. Returns true if safe. */
export function validateTemplate(template: string): boolean {
  return !UNSAFE_PATTERN.test(template);
}

/** Get the shared Handlebars instance with all built-in helpers. */
export function getHandlebars(): typeof hbs {
  return hbs;
}

/** Register a custom helper on the shared instance. Cannot overwrite built-ins. */
export function registerHelper(name: string, fn: (...args: unknown[]) => unknown): void {
  if (BUILTIN_HELPERS.has(name)) {
    throw new Error(`Cannot overwrite built-in helper "${name}"`);
  }
  hbs.registerHelper(name, fn);
}
