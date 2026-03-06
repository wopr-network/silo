// Engine module — state machine, invocation builder, gate evaluator, flow spawner, event emitter

export type { GateEvalResult } from "./gate-evaluator.js";
export { evaluateGate, hydrateTemplate } from "./gate-evaluator.js";
export type { ValidationError } from "./state-machine.js";
export { evaluateCondition, findTransition, validateFlow } from "./state-machine.js";
