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
  }

  async emit(event: EngineEvent): Promise<void> {
    const results = await Promise.allSettled(this.adapters.map((a) => Promise.resolve().then(() => a.emit(event))));
    for (const r of results) {
      if (r.status === "rejected") {
        this.logger.error("[EventEmitter] adapter error:", r.reason);
      }
    }
  }
}
