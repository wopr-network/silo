import type { Artifacts, IDomainEventRepository, IInvocationRepository, Invocation, Mode } from "../interfaces.js";
import { replayInvocation } from "./replay.js";

export class EventSourcedInvocationRepository implements IInvocationRepository {
  constructor(
    private readonly mutable: IInvocationRepository,
    private readonly domainEvents: IDomainEventRepository,
  ) {}

  async create(
    entityId: string,
    stage: string,
    prompt: string,
    mode: Mode,
    ttlMs: number | undefined,
    context: Record<string, unknown> | undefined,
    agentRole: string | null,
  ): Promise<Invocation> {
    return this.mutable.create(entityId, stage, prompt, mode, ttlMs, context, agentRole);
  }

  async get(id: string): Promise<Invocation | null> {
    const mutableInv = await this.mutable.get(id);
    if (!mutableInv) return null;

    const events = await this.domainEvents.list(mutableInv.entityId, { limit: 10000 });
    const invocationEvents = events.filter((e) => {
      const p = e.payload as Record<string, unknown>;
      return p.invocationId === id;
    });

    if (invocationEvents.length === 0) return mutableInv;

    return replayInvocation(id, invocationEvents) ?? mutableInv;
  }

  async claim(invocationId: string, agentId: string): Promise<Invocation | null> {
    return this.mutable.claim(invocationId, agentId);
  }

  async complete(id: string, signal: string, artifacts?: Artifacts): Promise<Invocation> {
    return this.mutable.complete(id, signal, artifacts);
  }

  async fail(id: string, error: string): Promise<Invocation> {
    return this.mutable.fail(id, error);
  }

  async releaseClaim(id: string): Promise<void> {
    return this.mutable.releaseClaim(id);
  }

  async findByEntity(entityId: string): Promise<Invocation[]> {
    return this.mutable.findByEntity(entityId);
  }

  async findUnclaimedWithAffinity(flowId: string, role: string, workerId: string): Promise<Invocation[]> {
    return this.mutable.findUnclaimedWithAffinity(flowId, role, workerId);
  }

  async findUnclaimedByFlow(flowId: string): Promise<Invocation[]> {
    return this.mutable.findUnclaimedByFlow(flowId);
  }

  async findByFlow(flowId: string): Promise<Invocation[]> {
    return this.mutable.findByFlow(flowId);
  }

  async reapExpired(): Promise<Invocation[]> {
    return this.mutable.reapExpired();
  }

  async findUnclaimedActive(flowId?: string): Promise<Invocation[]> {
    return this.mutable.findUnclaimedActive(flowId);
  }

  async countActiveByFlow(flowId: string): Promise<number> {
    return this.mutable.countActiveByFlow(flowId);
  }

  async countPendingByFlow(flowId: string): Promise<number> {
    return this.mutable.countPendingByFlow(flowId);
  }
}
