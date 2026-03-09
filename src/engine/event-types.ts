/** Event emitted by the engine during state-machine operations. */
export type EngineEvent =
  | { type: "entity.created"; entityId: string; flowId: string; payload: Record<string, unknown>; emittedAt: Date }
  | {
      type: "entity.transitioned";
      entityId: string;
      flowId: string;
      fromState: string;
      toState: string;
      trigger: string;
      emittedAt: Date;
    }
  | { type: "entity.claimed"; entityId: string; flowId: string; agentId: string; emittedAt: Date }
  | { type: "entity.released"; entityId: string; flowId: string; emittedAt: Date }
  | { type: "invocation.created"; entityId: string; invocationId: string; stage: string; emittedAt: Date }
  | { type: "invocation.claimed"; entityId: string; invocationId: string; agentId: string; emittedAt: Date }
  | { type: "invocation.completed"; entityId: string; invocationId: string; signal: string; emittedAt: Date }
  | { type: "invocation.failed"; entityId: string; invocationId: string; error: string; emittedAt: Date }
  | { type: "invocation.expired"; entityId: string; invocationId: string; emittedAt: Date }
  | { type: "gate.passed"; entityId: string; gateId: string; emittedAt: Date }
  | { type: "gate.failed"; entityId: string; gateId: string; emittedAt: Date }
  | { type: "gate.timedOut"; entityId: string; gateId: string; emittedAt: Date }
  | { type: "gate.redirected"; entityId: string; gateId: string; outcome: string; toState: string; emittedAt: Date }
  | { type: "flow.spawned"; entityId: string; flowId: string; spawnedFlowId: string; emittedAt: Date }
  | { type: "definition.changed"; flowId: string; tool: string; payload: Record<string, unknown>; emittedAt: Date }
  | { type: "onEnter.completed"; entityId: string; state: string; artifacts: Record<string, unknown>; emittedAt: Date }
  | { type: "onEnter.failed"; entityId: string; state: string; error: string; emittedAt: Date }
  | { type: "onEnter.skipped"; entityId: string; state: string; emittedAt: Date }
  | { type: "onExit.completed"; entityId: string; state: string; emittedAt: Date }
  | { type: "onExit.failed"; entityId: string; state: string; error: string; emittedAt: Date };

/** Adapter for broadcasting engine events to external systems. */
export interface IEventBusAdapter {
  /** Emit an engine event to subscribed listeners. */
  emit(event: EngineEvent): Promise<void>;
}
