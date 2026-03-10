import type { IngestEvent } from "../ingestion/types.js";
import { getSignatureHeader, verifyWebhookSignature } from "../radar-db/hmac.js";
import type { Source, Watch } from "../radar-db/types.js";
import type { SourceAdapter } from "./adapter.js";
import type { WebhookWatchConfig } from "./linear/webhook-handler.js";
import { handleLinearWebhook } from "./linear/webhook-handler.js";

export class LinearSourceAdapter implements SourceAdapter {
  readonly type = "linear";

  parseEvent(payload: unknown, source: Source, watches: Watch[]): IngestEvent | null {
    for (const watch of watches) {
      if (!watch.enabled) continue;
      const actionConfig = watch.action_config ?? {};
      const flowName = typeof actionConfig.flowName === "string" ? actionConfig.flowName : undefined;
      if (!flowName) continue;

      const signal = typeof actionConfig.signal === "string" ? actionConfig.signal : undefined;

      const filterConfig = watch.filter ?? {};
      const config: WebhookWatchConfig = {
        sourceId: source.id,
        flowName,
        signal,
        filter: {
          state: typeof filterConfig.state === "string" ? filterConfig.state : undefined,
          labels: Array.isArray(filterConfig.labels) ? (filterConfig.labels as string[]) : undefined,
          stateId: typeof filterConfig.stateId === "string" ? filterConfig.stateId : undefined,
          labelIds: Array.isArray(filterConfig.labelIds) ? (filterConfig.labelIds as string[]) : undefined,
        },
      };

      const event = handleLinearWebhook(payload, config);
      if (event) return event;
    }
    return null;
  }

  verifySignature(
    rawBody: string,
    source: Source,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; error?: string } {
    const secret =
      typeof source.config.secret === "string" && source.config.secret.length > 0 ? source.config.secret : undefined;
    if (!secret) return { valid: true };

    const headerName = getSignatureHeader(source);
    const headerValue = headers[headerName];
    const sig = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return verifyWebhookSignature(rawBody, secret, sig);
  }
}
