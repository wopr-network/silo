import type { EngineEvent, IEventBusAdapter } from "../adapters/interfaces.js";

export class EventEmitter implements IEventBusAdapter {
  private adapters: IEventBusAdapter[] = [];

  register(adapter: IEventBusAdapter): void {
    this.adapters.push(adapter);
  }

  async emit(event: EngineEvent): Promise<void> {
    const results = await Promise.allSettled(this.adapters.map((a) => Promise.resolve().then(() => a.emit(event))));
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[EventEmitter] adapter error:", r.reason);
      }
    }
  }
}
