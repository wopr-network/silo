import { and, eq } from "drizzle-orm";
import type { EngineEvent, IEventBusAdapter } from "../engine/event-types.js";
import { holyshipperContainers } from "../repositories/drizzle/schema.js";
import type { IFleetManager } from "./provision-holyshipper.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
type Db = any;

/**
 * Manages the lifecycle of holyshipper containers in response to engine events.
 * Uses the `holyshipper_containers` DB table (not in-memory Map) for persistence.
 */
export class EntityLifecycleManager implements IEventBusAdapter {
  constructor(
    private db: Db,
    private tenantId: string,
    private fleetManager: IFleetManager,
  ) {}

  async emit(event: EngineEvent): Promise<void> {
    switch (event.type) {
      case "invocation.created":
        await this.onInvocationCreated(event);
        break;
      case "gate.failed":
      case "gate.timedOut":
        await this.onGateFailure(event);
        break;
      case "entity.transitioned":
        await this.onTransition(event);
        break;
    }
  }

  private async onInvocationCreated(event: EngineEvent & { type: "invocation.created" }): Promise<void> {
    const entityId = event.entityId;
    // Check if a container already exists for this entity
    const existing = await this.db
      .select()
      .from(holyshipperContainers)
      .where(
        and(
          eq(holyshipperContainers.entityId, entityId),
          eq(holyshipperContainers.tenantId, this.tenantId),
          eq(holyshipperContainers.status, "running"),
        ),
      );
    if (existing.length > 0) return;

    // Create a pending record
    const id = crypto.randomUUID();
    await this.db.insert(holyshipperContainers).values({
      id,
      tenantId: this.tenantId,
      entityId,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Provision the container
    try {
      const containerId = await this.fleetManager.provision(entityId, {
        entityId,
        flowName: "",
        owner: "",
        repo: "",
        issueNumber: 0,
        githubToken: "",
      });
      await this.db
        .update(holyshipperContainers)
        .set({
          containerId,
          status: "running",
          provisionedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(holyshipperContainers.id, id));
    } catch {
      await this.db
        .update(holyshipperContainers)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(holyshipperContainers.id, id));
    }
  }

  private async onGateFailure(event: EngineEvent & { type: "gate.failed" | "gate.timedOut" }): Promise<void> {
    await this.teardownForEntity(event.entityId);
  }

  private async onTransition(event: EngineEvent & { type: "entity.transitioned" }): Promise<void> {
    // Check if the new state is terminal (done, failed, cancelled, budget_exceeded)
    const terminalStates = ["done", "failed", "cancelled", "budget_exceeded"];
    if ("toState" in event && terminalStates.includes(event.toState as string)) {
      await this.teardownForEntity(event.entityId);
    }
  }

  private async teardownForEntity(entityId: string): Promise<void> {
    const containers = await this.db
      .select()
      .from(holyshipperContainers)
      .where(
        and(
          eq(holyshipperContainers.entityId, entityId),
          eq(holyshipperContainers.tenantId, this.tenantId),
          eq(holyshipperContainers.status, "running"),
        ),
      );

    for (const container of containers) {
      if (container.containerId) {
        try {
          await this.fleetManager.teardown(container.containerId);
        } catch {
          // Best effort teardown
        }
      }
      await this.db
        .update(holyshipperContainers)
        .set({ status: "torn_down", tornDownAt: new Date(), updatedAt: new Date() })
        .where(eq(holyshipperContainers.id, container.id));
    }
  }
}
