import type { EngineEvent, IEventBusAdapter } from "./interfaces.js";

const EVENT_EMOJI: Record<string, string> = {
  "entity.created": "🆕",
  "entity.transitioned": "➡️",
  "entity.claimed": "🔒",
  "entity.released": "🔓",
  "invocation.created": "📝",
  "invocation.claimed": "🤖",
  "invocation.completed": "✔️",
  "invocation.failed": "❌",
  "invocation.expired": "⏰",
  "gate.passed": "🟢",
  "gate.failed": "🔴",
  "flow.spawned": "🌱",
};

export class StdoutAdapter implements IEventBusAdapter {
  async emit(event: EngineEvent): Promise<void> {
    const timestamp = new Date().toISOString();
    const emoji = EVENT_EMOJI[event.type] ?? "📋";
    console.log(`${emoji} [${timestamp}] ${event.type}`, JSON.stringify(event, null, 2));
  }
}
