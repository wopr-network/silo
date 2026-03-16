import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { EngineEvent, IEventBusAdapter } from "./event-types.js";

export class EventEmitter implements IEventBusAdapter {
  private adapters: IEventBusAdapter[] = [];
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? consoleLogger;
  }

  register(adapter: IEventBusAdapter): void {
    this.adapters.push(adapter);
    this.logger.info("[EventEmitter] adapter registered", {
      adapterCount: this.adapters.length,
      adapterType: adapter.constructor?.name ?? "unknown",
    });
  }

  async emit(event: EngineEvent): Promise<void> {
    const eventType = event.type;
    const entityId = "entityId" in event ? event.entityId : undefined;

    this.logger.info("[EventEmitter] emitting", {
      type: eventType,
      entityId,
      adapterCount: this.adapters.length,
    });

    const results = await Promise.allSettled(this.adapters.map((a) => Promise.resolve().then(() => a.emit(event))));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        const reason = r.reason instanceof Error ? r.reason : new Error(String(r.reason));
        this.logger.error("[EventEmitter] adapter REJECTED", {
          type: eventType,
          entityId,
          adapterIndex: i,
          adapterType: this.adapters[i]?.constructor?.name ?? "unknown",
          error: reason.message,
          stack: reason.stack,
        });
      }
    }

    this.logger.info("[EventEmitter] emit complete", {
      type: eventType,
      entityId,
      settled: results.length,
      rejected: results.filter((r) => r.status === "rejected").length,
    });
  }
}
