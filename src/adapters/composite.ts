import type { EngineEvent, IEventBusAdapter } from "./interfaces.js";

export class CompositeEventBusAdapter implements IEventBusAdapter {
  private adapters: IEventBusAdapter[];

  constructor(adapters: IEventBusAdapter[]) {
    this.adapters = adapters;
  }

  async emit(event: EngineEvent): Promise<void> {
    await Promise.all(
      this.adapters.map((a) =>
        a.emit(event).catch((err) => {
          console.error("[composite-adapter] Child adapter failed:", err);
        }),
      ),
    );
  }
}
