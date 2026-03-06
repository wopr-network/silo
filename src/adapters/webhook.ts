import { createHmac } from "node:crypto";
import { z } from "zod/v4";
import { matchEventPattern } from "./glob.js";
import type { EngineEvent, IEventBusAdapter } from "./interfaces.js";

export const WebhookEndpointSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  headers: z.record(z.string(), z.string()).optional(),
  secret: z.string().optional(),
});

export const WebhookAdapterConfigSchema = z.object({
  endpoints: z.array(WebhookEndpointSchema).min(1),
});
export type WebhookAdapterConfig = z.infer<typeof WebhookAdapterConfigSchema>;

type FetchFn = typeof globalThis.fetch;

export class WebhookEventBusAdapter implements IEventBusAdapter {
  private config: WebhookAdapterConfig;
  private fetch: FetchFn;

  constructor(config: WebhookAdapterConfig, fetchFn: FetchFn = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchFn;
  }

  async emit(event: EngineEvent): Promise<void> {
    const matching = this.config.endpoints.filter((ep) =>
      ep.events.some((pattern) => matchEventPattern(pattern, event.type)),
    );

    await Promise.all(matching.map((ep) => this.deliver(ep, event)));
  }

  private async deliver(endpoint: WebhookAdapterConfig["endpoints"][number], event: EngineEvent): Promise<void> {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...endpoint.headers,
    };

    if (endpoint.secret) {
      headers["X-Signature"] = `sha256=${createHmac("sha256", endpoint.secret).update(body).digest("hex")}`;
    }

    try {
      const res = await this.fetch(endpoint.url, { method: "POST", headers, body });

      if (!res.ok && res.status >= 500) {
        const retry = await this.fetch(endpoint.url, { method: "POST", headers, body });
        if (!retry.ok) {
          console.error(`[webhook-adapter] Failed to deliver to ${endpoint.url} after retry: ${retry.status}`);
        }
      } else if (!res.ok) {
        console.error(`[webhook-adapter] HTTP ${res.status} from ${endpoint.url}`);
      }
    } catch (err) {
      console.error(`[webhook-adapter] Failed to deliver to ${endpoint.url}:`, err);
    }
  }
}
