import { z } from "zod/v4";
import type { EngineEvent, IEventBusAdapter } from "./interfaces.js";

export const DiscordAdapterConfigSchema = z.object({
  token: z.string().min(1),
  routes: z.record(z.string(), z.object({ channel: z.string().min(1) })),
});
export type DiscordAdapterConfig = z.infer<typeof DiscordAdapterConfigSchema>;

const DISCORD_API = "https://discord.com/api/v10";

const FAILURE_TYPES = new Set(["invocation.failed", "invocation.expired", "gate.failed"]);

function eventColor(eventType: string): number {
  return FAILURE_TYPES.has(eventType) ? 0xe74c3c : 0x2ecc71;
}

function stringifyField(v: unknown): string {
  const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  return s.length > 1024 ? `${s.slice(0, 1021)}...` : s;
}

function eventToEmbed(event: EngineEvent): Record<string, unknown> {
  const fields: { name: string; value: string; inline: boolean }[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === "type" || key === "emittedAt") continue;
    fields.push({ name: key, value: stringifyField(value), inline: true });
  }
  return {
    title: event.type,
    color: eventColor(event.type),
    fields,
    timestamp: event.emittedAt.toISOString(),
  };
}

type FetchFn = typeof globalThis.fetch;

export class DiscordEventBusAdapter implements IEventBusAdapter {
  private config: DiscordAdapterConfig;
  private fetch: FetchFn;

  constructor(config: DiscordAdapterConfig, fetchFn: FetchFn = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchFn;
  }

  async emit(event: EngineEvent): Promise<void> {
    const route = this.config.routes[event.type];
    if (!route) return;

    const url = `${DISCORD_API}/channels/${route.channel}/messages`;
    const body = JSON.stringify({ embeds: [eventToEmbed(event)] });

    try {
      const res = await this.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (!res.ok) {
        console.error(`[discord-adapter] HTTP ${res.status} posting to channel ${route.channel}`);
      }
    } catch (err) {
      console.error(`[discord-adapter] Failed to send event ${event.type}:`, err);
    }
  }
}
