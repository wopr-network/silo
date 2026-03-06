import Handlebars from "handlebars";
import type { Flow, Transition } from "../repositories/interfaces.js";

// ─── Shared Handlebars Instance ───

const hbs = Handlebars.create();

hbs.registerHelper("gt", (a: number, b: number) => (a > b ? "true" : ""));
hbs.registerHelper("lt", (a: number, b: number) => (a < b ? "true" : ""));
hbs.registerHelper("eq", (a: unknown, b: unknown) => (String(a) === String(b) ? "true" : ""));

hbs.registerHelper("invocation_count", (entity: { invocations?: { stage: string }[] }, stage: string) =>
  String(entity.invocations?.filter((i) => i.stage === stage).length ?? 0),
);

hbs.registerHelper("gate_passed", (entity: { gateResults?: { gate: string; passed: boolean }[] }, gateName: string) =>
  (entity.gateResults?.some((g) => g.gate === gateName && g.passed) ?? false) ? "true" : "",
);

hbs.registerHelper("has_artifact", (entity: { artifacts?: Record<string, unknown> }, key: string) =>
  entity.artifacts?.[key] !== undefined ? "true" : "",
);

hbs.registerHelper("time_in_state", (entity: { updatedAt: string | Date }) =>
  String(Date.now() - new Date(entity.updatedAt).getTime()),
);

// ─── Condition Evaluation ───

export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  try {
    const template = hbs.compile(condition);
    const result = template(context).trim();
    return result.length > 0 && result !== "false" && result !== "0";
  } catch (err) {
    console.error("[state-machine] evaluateCondition error:", err);
    return false;
  }
}

// ─── Transition Matching ───

export function findTransition(
  flow: Flow,
  currentState: string,
  signal: string,
  context: Record<string, unknown>,
): Transition | null {
  const candidates = flow.transitions
    .filter((t) => t.fromState === currentState && t.trigger === signal)
    .sort((a, b) => b.priority - a.priority);

  for (const candidate of candidates) {
    if (candidate.gateId !== null) {
      const entity = context["entity"] as { gateResults?: { gate: string; passed: boolean }[] } | undefined;
      const gatePassed = entity?.gateResults?.some((g) => g.gate === candidate.gateId && g.passed) ?? false;
      if (!gatePassed) continue;
    }
    if (candidate.condition === null || evaluateCondition(candidate.condition, context)) {
      return candidate;
    }
  }

  return null;
}

// ─── Flow Validation ───

export interface ValidationError {
  message: string;
}

export function validateFlow(flow: Flow): ValidationError[] {
  const errors: ValidationError[] = [];
  const stateNames = new Set(flow.states.map((s) => s.name));

  if (!stateNames.has(flow.initialState)) {
    errors.push({ message: `initialState "${flow.initialState}" is not a defined state` });
  }

  for (const t of flow.transitions) {
    if (!stateNames.has(t.fromState)) {
      errors.push({ message: `Transition from non-existent state "${t.fromState}"` });
    }
    if (!stateNames.has(t.toState)) {
      errors.push({ message: `Transition to non-existent state "${t.toState}"` });
    }
  }

  if (stateNames.has(flow.initialState)) {
    const reachable = new Set<string>();
    const queue = [flow.initialState];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const t of flow.transitions) {
        if (t.fromState === current && stateNames.has(t.toState) && !reachable.has(t.toState)) {
          queue.push(t.toState);
        }
      }
    }
    for (const name of stateNames) {
      if (!reachable.has(name)) {
        errors.push({ message: `State "${name}" is unreachable from initialState` });
      }
    }
  }

  return errors;
}
