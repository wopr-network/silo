import type { IEventBusAdapter } from "../engine/event-types.js";
import type { IFleetManager, IServiceKeyRepo } from "./provision-holyshipper.js";
import { provisionHolyshipper, teardownHolyshipper } from "./provision-holyshipper.js";

export interface EntityLifecycleConfig {
  fleet: IFleetManager;
  serviceKeyRepo: IServiceKeyRepo;
  gatewayUrl: string;
  holyshipUrl: string;
  holyshipperImage: string;
  githubAppId: string;
  githubAppPrivateKey: string;
}

/**
 * Tracks active holyshipper containers by entity ID.
 * Provisions on entity.created, tears down on terminal state.
 */
export class EntityLifecycleManager {
  private activeContainers = new Map<string, { containerId: string }>();
  private config: EntityLifecycleConfig;

  constructor(config: EntityLifecycleConfig) {
    this.config = config;
  }

  /**
   * Register as a listener on the engine's event bus.
   * Automatically provisions/teardowns holyshippers based on engine events.
   */
  createEventHandler(): IEventBusAdapter {
    return {
      emit: async (event) => {
        if (event.type === "entity.created") {
          await this.onEntityCreated(event as EntityCreatedEvent);
        }
        // Terminal states trigger teardown
        if (event.type === "entity.transitioned") {
          const e = event as EntityTransitionedEvent;
          if (isTerminalTransition(e)) {
            await this.onEntityCompleted(e.entityId);
          }
        }
      },
    };
  }

  private async onEntityCreated(_event: EntityCreatedEvent): Promise<void> {
    // Provisioning is handled by the webhook handler or Ship It endpoint
    // calling provisionForEntity() directly after entity creation.
  }

  private async onEntityCompleted(entityId: string): Promise<void> {
    const container = this.activeContainers.get(entityId);
    if (!container) return;

    await teardownHolyshipper({
      containerId: container.containerId,
      fleet: this.config.fleet,
      serviceKeyRepo: this.config.serviceKeyRepo,
    });

    this.activeContainers.delete(entityId);
  }

  /**
   * Provision a holyshipper for a specific entity.
   * Called by webhook handler or Ship It endpoint after entity creation.
   */
  async provisionForEntity(opts: {
    entityId: string;
    tenantId: string;
    installationId: number;
    discipline: string;
    repoFullName: string;
  }): Promise<void> {
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

    this.activeContainers.set(opts.entityId, { containerId: result.containerId });
  }

  /** Get count of active holyshipper containers. */
  get activeCount(): number {
    return this.activeContainers.size;
  }
}

// Event type helpers
interface EntityCreatedEvent {
  type: "entity.created";
  entityId: string;
  flowId: string;
  payload: Record<string, unknown>;
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

function isTerminalTransition(event: EntityTransitionedEvent): boolean {
  return TERMINAL_STATES.has(event.toState);
}
