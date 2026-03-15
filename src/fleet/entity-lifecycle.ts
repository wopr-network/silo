import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { IEventBusAdapter } from "../engine/event-types.js";
import { holyshipperContainers } from "../repositories/drizzle/schema.js";
import type { IEntityRepository } from "../repositories/interfaces.js";
import type { IFleetManager, IServiceKeyRepo } from "./provision-holyshipper.js";
import { provisionHolyshipper, teardownHolyshipper } from "./provision-holyshipper.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver Drizzle compat
type Db = any;

export interface EntityLifecycleConfig {
  fleet: IFleetManager;
  serviceKeyRepo: IServiceKeyRepo;
  entityRepo: IEntityRepository;
  db: Db;
  gatewayUrl: string;
  holyshipUrl: string;
  holyshipperImage: string;
  githubAppId: string;
  githubAppPrivateKey: string;
}

/**
 * Tracks active holyshipper containers in the database.
 *
 * Provisions holyshippers when work is available:
 * - On invocation.created when no active holyshipper exists (e.g., after human approval)
 *
 * Tears down holyshippers when:
 * - Entity reaches a terminal state (done, cancelled, budget_exceeded, stuck)
 * - Entity is gated (waiting for approval — no work to do)
 */
export class EntityLifecycleManager {
  private config: EntityLifecycleConfig;

  constructor(config: EntityLifecycleConfig) {
    this.config = config;
  }

  /**
   * Register as a listener on the engine's event bus.
   * Handles the full lifecycle: provision on work, teardown on completion or gate.
   */
  createEventHandler(): IEventBusAdapter {
    return {
      emit: async (event) => {
        // New invocation created and no holyshipper active → provision one
        if (event.type === "invocation.created") {
          const e = event as InvocationCreatedEvent;
          const active = await this.isActive(e.entityId);
          if (!active) {
            await this.provisionFromEntity(e.entityId);
          }
        }

        // Gate blocked → tear down holyshipper (it has nothing to do)
        if (event.type === "gate.failed" || event.type === "gate.timedOut") {
          const e = event as GateEvent;
          await this.teardownForEntity(e.entityId);
        }

        // Terminal state → tear down
        if (event.type === "entity.transitioned") {
          const e = event as EntityTransitionedEvent;
          if (TERMINAL_STATES.has(e.toState)) {
            await this.teardownForEntity(e.entityId);
          }
        }
      },
    };
  }

  /**
   * Provision a holyshipper by reading entity artifacts for context.
   * Used when an invocation is created after a human approval or gate pass.
   */
  private async provisionFromEntity(entityId: string): Promise<void> {
    const entity = await this.config.entityRepo.get(entityId);
    if (!entity?.artifacts) return;

    const { installationId, repoFullName, tenantId } = entity.artifacts as {
      installationId?: number;
      repoFullName?: string;
      tenantId?: string;
    };

    if (!installationId || !repoFullName || !tenantId) return;

    await this.provisionForEntity({
      entityId,
      tenantId,
      installationId,
      discipline: "engineering",
      repoFullName,
    });
  }

  private async teardownForEntity(entityId: string): Promise<void> {
    const rows = await this.config.db
      .select()
      .from(holyshipperContainers)
      .where(eq(holyshipperContainers.entityId, entityId))
      .limit(1);
    const row = rows[0];
    if (!row || row.status !== "running") return;

    await teardownHolyshipper({
      containerId: row.containerId,
      fleet: this.config.fleet,
      serviceKeyRepo: this.config.serviceKeyRepo,
    });

    await this.config.db
      .update(holyshipperContainers)
      .set({ status: "stopped", stoppedAt: Date.now() })
      .where(eq(holyshipperContainers.id, row.id));
  }

  /**
   * Provision a holyshipper for a specific entity.
   * Called by webhook handler, Ship It endpoint, or automatically
   * when an invocation is created with no active holyshipper.
   */
  async provisionForEntity(opts: {
    entityId: string;
    tenantId: string;
    installationId: number;
    discipline: string;
    repoFullName: string;
  }): Promise<void> {
    // Don't double-provision
    if (await this.isActive(opts.entityId)) return;

    const result = await provisionHolyshipper({
      ...opts,
      fleet: this.config.fleet,
      serviceKeyRepo: this.config.serviceKeyRepo,
      gatewayUrl: this.config.gatewayUrl,
      holyshipUrl: this.config.holyshipUrl,
      holyshipperImage: this.config.holyshipperImage,
      githubAppId: this.config.githubAppId,
      githubAppPrivateKey: this.config.githubAppPrivateKey,
    });

    await this.config.db.insert(holyshipperContainers).values({
      id: randomUUID(),
      entityId: opts.entityId,
      tenantId: opts.tenantId,
      containerId: result.containerId,
      status: "running",
      createdAt: Date.now(),
    });
  }

  /** Check if a holyshipper is active for an entity. */
  async isActive(entityId: string): Promise<boolean> {
    const rows = await this.config.db
      .select()
      .from(holyshipperContainers)
      .where(eq(holyshipperContainers.entityId, entityId))
      .limit(1);
    return rows.length > 0 && rows[0].status === "running";
  }

  /** Get count of active holyshipper containers. */
  async activeCount(): Promise<number> {
    const rows = await this.config.db
      .select()
      .from(holyshipperContainers)
      .where(eq(holyshipperContainers.status, "running"));
    return rows.length;
  }
}

// Event type helpers
interface InvocationCreatedEvent {
  type: "invocation.created";
  entityId: string;
  invocationId: string;
  stage: string;
  emittedAt: Date;
}

interface GateEvent {
  type: "gate.failed" | "gate.timedOut";
  entityId: string;
  gateId: string;
  emittedAt: Date;
}

interface EntityTransitionedEvent {
  type: "entity.transitioned";
  entityId: string;
  flowId: string;
  fromState: string;
  toState: string;
  trigger: string;
  emittedAt: Date;
}

const TERMINAL_STATES = new Set(["done", "cancelled", "budget_exceeded", "stuck"]);
