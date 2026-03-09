import type { ServerResponse } from "node:http";
import type { EngineEvent, IEventBusAdapter } from "../engine/event-types.js";

export class UiSseAdapter implements IEventBusAdapter {
  private clients = new Set<ServerResponse>();

  addClient(res: ServerResponse): void {
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async emit(event: EngineEvent): Promise<void> {
    const { emittedAt, ...rest } = event;
    const msg = JSON.stringify({ ...rest, timestamp: emittedAt.toISOString() });
    const frame = `data: ${msg}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
