// Engine module — state machine, invocation builder, gate evaluator, flow spawner, event emitter

export type { Logger } from "../logger.js";
export { consoleLogger, noopLogger } from "../logger.js";
export type { DirectFlowEngineDeps } from "./direct-flow-engine.js";
export { DirectFlowEngine } from "./direct-flow-engine.js";
export type { ClaimWorkResult, EngineDeps, EngineStatus, ProcessSignalResult } from "./engine.js";
export { Engine } from "./engine.js";
export { EventEmitter } from "./event-emitter.js";
export type { EngineEvent, IEventBusAdapter } from "./event-types.js";
export type { FlowEngineRequestOptions, IFlowEngine } from "./flow-engine-interface.js";
export { executeSpawn } from "./flow-spawner.js";
export type { GateEvalResult } from "./gate-evaluator.js";
export { evaluateGate } from "./gate-evaluator.js";
export type { InvocationBuild } from "./invocation-builder.js";
export type { ValidationError } from "./state-machine.js";
export { evaluateCondition, findTransition, isTerminal, validateFlow } from "./state-machine.js";
