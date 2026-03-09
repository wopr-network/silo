import type {
  Artifacts,
  Entity,
  IDomainEventRepository,
  IEntityRepository,
  IEntitySnapshotRepository,
  Refs,
} from "../interfaces.js";
import { replayEntity } from "./replay.js";

const DEFAULT_SNAPSHOT_INTERVAL = 10;

export class EventSourcedEntityRepository implements IEntityRepository {
  private readonly snapshotInterval: number;

  constructor(
    private readonly mutable: IEntityRepository,
    private readonly domainEvents: IDomainEventRepository,
    private readonly snapshots: IEntitySnapshotRepository,
    snapshotInterval?: number,
  ) {
    this.snapshotInterval = snapshotInterval ?? DEFAULT_SNAPSHOT_INTERVAL;
  }

  async create(flowId: string, initialState: string, refs?: Refs, flowVersion?: number): Promise<Entity> {
    return this.mutable.create(flowId, initialState, refs, flowVersion);
  }

  async get(id: string): Promise<Entity | null> {
    const snapshot = await this.snapshots.loadLatest(id);
    const afterSeq = snapshot?.sequence ?? 0;

    const eventsAfterSnapshot = await this.domainEvents.list(id, { minSequence: afterSeq, limit: 10000 });

    if (eventsAfterSnapshot.length === 0 && !snapshot) {
      return this.mutable.get(id);
    }

    const entity = replayEntity(snapshot?.state ?? null, eventsAfterSnapshot, id);

    if (!entity) {
      return this.mutable.get(id);
    }

    if (eventsAfterSnapshot.length >= this.snapshotInterval) {
      const lastEvent = eventsAfterSnapshot[eventsAfterSnapshot.length - 1];
      try {
        await this.snapshots.save(id, lastEvent.sequence, entity);
      } catch {
        // snapshot write failure is non-fatal — continue with in-memory entity
      }
    }

    return entity;
  }

  async findByFlowAndState(flowId: string, state: string, limit?: number): Promise<Entity[]> {
    return this.mutable.findByFlowAndState(flowId, state, limit);
  }

  async hasAnyInFlowAndState(flowId: string, stateNames: string[]): Promise<boolean> {
    return this.mutable.hasAnyInFlowAndState(flowId, stateNames);
  }

  async transition(id: string, toState: string, trigger: string, artifacts?: Partial<Artifacts>): Promise<Entity> {
    return this.mutable.transition(id, toState, trigger, artifacts);
  }

  async updateArtifacts(id: string, artifacts: Partial<Artifacts>): Promise<void> {
    return this.mutable.updateArtifacts(id, artifacts);
  }

  async claim(flowId: string, state: string, agentId: string): Promise<Entity | null> {
    return this.mutable.claim(flowId, state, agentId);
  }

  async claimById(entityId: string, agentId: string): Promise<Entity | null> {
    return this.mutable.claimById(entityId, agentId);
  }

  async release(entityId: string, agentId: string): Promise<void> {
    return this.mutable.release(entityId, agentId);
  }

  async reapExpired(ttlMs: number): Promise<string[]> {
    return this.mutable.reapExpired(ttlMs);
  }

  async setAffinity(entityId: string, workerId: string, role: string, expiresAt: Date): Promise<void> {
    return this.mutable.setAffinity(entityId, workerId, role, expiresAt);
  }

  async clearExpiredAffinity(): Promise<string[]> {
    return this.mutable.clearExpiredAffinity();
  }

  async appendSpawnedChild(
    parentId: string,
    entry: { childId: string; childFlow: string; spawnedAt: string },
  ): Promise<void> {
    return this.mutable.appendSpawnedChild(parentId, entry);
  }

  async findByParentId(parentEntityId: string): Promise<Entity[]> {
    return this.mutable.findByParentId(parentEntityId);
  }

  async cancelEntity(entityId: string): Promise<void> {
    return this.mutable.cancelEntity(entityId);
  }

  async resetEntity(entityId: string, targetState: string): Promise<Entity> {
    return this.mutable.resetEntity(entityId, targetState);
  }

  async updateFlowVersion(entityId: string, version: number): Promise<void> {
    return this.mutable.updateFlowVersion(entityId, version);
  }
}
