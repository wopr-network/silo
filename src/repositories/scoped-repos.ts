import { DrizzleDomainEventRepository } from "./drizzle/domain-event.repo.js";
import { DrizzleEntityRepository } from "./drizzle/entity.repo.js";
import { DrizzleEntitySnapshotRepository } from "./drizzle/entity-snapshot.repo.js";
import { DrizzleEventRepository } from "./drizzle/event.repo.js";
import { DrizzleFlowRepository } from "./drizzle/flow.repo.js";
import { DrizzleGateRepository } from "./drizzle/gate.repo.js";
import { DrizzleInvocationRepository } from "./drizzle/invocation.repo.js";
import { DrizzleTransitionLogRepository } from "./drizzle/transition-log.repo.js";
import type {
  IDomainEventRepository,
  IEntityRepository,
  IEntitySnapshotRepository,
  IEventRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "./interfaces.js";

export interface ScopedRepos {
  entities: IEntityRepository;
  flows: IFlowRepository;
  invocations: IInvocationRepository;
  gates: IGateRepository;
  transitionLog: ITransitionLogRepository;
  events: IEventRepository;
  domainEvents: IDomainEventRepository;
  snapshots: IEntitySnapshotRepository;
}

/**
 * Creates a complete set of repositories pre-bound to a specific tenant.
 * Every query automatically filters by tenant_id — prevents cross-tenant leaks by construction.
 */
// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat (postgres-js + PGlite)
export function createScopedRepos(db: any, tenantId: string): ScopedRepos {
  return {
    entities: new DrizzleEntityRepository(db, tenantId),
    flows: new DrizzleFlowRepository(db, tenantId),
    invocations: new DrizzleInvocationRepository(db, tenantId),
    gates: new DrizzleGateRepository(db, tenantId),
    transitionLog: new DrizzleTransitionLogRepository(db, tenantId),
    events: new DrizzleEventRepository(db, tenantId),
    domainEvents: new DrizzleDomainEventRepository(db, tenantId),
    snapshots: new DrizzleEntitySnapshotRepository(db, tenantId),
  };
}
