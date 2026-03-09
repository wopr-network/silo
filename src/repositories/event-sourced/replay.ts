import type { Artifacts, DomainEvent, Entity, Invocation, Mode, Refs } from "../interfaces.js";

/**
 * Replay entity state from a snapshot (or null) plus subsequent domain events.
 * Events must be ordered by sequence ascending.
 */
export function replayEntity(snapshot: Entity | null, events: DomainEvent[], entityId: string): Entity | null {
  let state = snapshot ? { ...snapshot } : null;

  for (const event of events) {
    if (event.entityId !== entityId) continue;

    switch (event.type) {
      case "entity.created": {
        const p = event.payload as Record<string, unknown>;
        state = {
          id: entityId,
          flowId: p.flowId as string,
          state: (p.initialState as string) ?? "initial",
          refs: (p.refs as Refs) ?? null,
          artifacts: null,
          claimedBy: null,
          claimedAt: null,
          flowVersion: (p.flowVersion as number) ?? 1,
          priority: 0,
          createdAt: new Date(event.emittedAt),
          updatedAt: new Date(event.emittedAt),
          affinityWorkerId: null,
          affinityRole: null,
          affinityExpiresAt: null,
          parentEntityId: null,
        };
        break;
      }
      case "entity.transitioned": {
        if (!state) break;
        const p = event.payload as Record<string, unknown>;
        state.state = p.toState as string;
        if (p.artifacts) {
          state.artifacts = { ...(state.artifacts ?? {}), ...(p.artifacts as Record<string, unknown>) };
        }
        state.updatedAt = new Date(event.emittedAt);
        state.claimedBy = null;
        state.claimedAt = null;
        break;
      }
      case "entity.claimed": {
        if (!state) break;
        const p = event.payload as Record<string, unknown>;
        state.claimedBy = p.agentId as string;
        state.claimedAt = new Date(event.emittedAt);
        state.updatedAt = new Date(event.emittedAt);
        break;
      }
      case "entity.released": {
        if (!state) break;
        state.claimedBy = null;
        state.claimedAt = null;
        state.updatedAt = new Date(event.emittedAt);
        break;
      }
      // invocation.*, gate.*, onEnter.*, onExit.*, flow.spawned — no entity state mutation
    }
  }

  return state;
}

/**
 * Replay a single invocation's state from domain events.
 * Filters events by invocationId in the payload.
 */
export function replayInvocation(invocationId: string, events: DomainEvent[]): Invocation | null {
  let state: Invocation | null = null;

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    if (p.invocationId !== invocationId) continue;

    switch (event.type) {
      case "invocation.created": {
        state = {
          id: invocationId,
          entityId: event.entityId,
          stage: p.stage as string,
          agentRole: (p.agentRole as string) ?? null,
          mode: (p.mode as Mode) ?? "active",
          prompt: (p.prompt as string) ?? "",
          context: (p.context as Record<string, unknown>) ?? null,
          claimedBy: null,
          claimedAt: null,
          startedAt: null,
          completedAt: null,
          failedAt: null,
          signal: null,
          artifacts: null,
          error: null,
          ttlMs: (p.ttlMs as number) ?? 1800000,
        };
        break;
      }
      case "invocation.claimed": {
        if (!state) break;
        state.claimedBy = p.agentId as string;
        state.claimedAt = new Date(event.emittedAt);
        state.startedAt = new Date(event.emittedAt);
        break;
      }
      case "invocation.completed": {
        if (!state) break;
        state.completedAt = new Date(event.emittedAt);
        state.signal = (p.signal as string) ?? null;
        if (p.artifacts) {
          state.artifacts = p.artifacts as Artifacts;
        }
        break;
      }
      case "invocation.failed": {
        if (!state) break;
        state.failedAt = new Date(event.emittedAt);
        state.error = (p.error as string) ?? null;
        break;
      }
      case "invocation.expired": {
        if (!state) break;
        state.claimedBy = null;
        state.claimedAt = null;
        state.startedAt = null;
        break;
      }
    }
  }

  return state;
}
