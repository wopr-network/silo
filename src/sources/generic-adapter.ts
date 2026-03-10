import { createHash } from "node:crypto";
import type { IngestEvent } from "../ingestion/types.js";
import { getSignatureHeader, verifyWebhookSignature } from "../radar-db/hmac.js";
import type { Source, Watch } from "../radar-db/types.js";
import type { SourceAdapter } from "./adapter.js";

export class GenericSourceAdapter implements SourceAdapter {
  readonly type = "webhook";

  parseEvent(payload: unknown, source: Source, watches: Watch[]): IngestEvent | null {
    let flowName: string | undefined;
    for (const w of watches) {
      if (!w.enabled) continue;
      const candidate = typeof w.action_config.flowName === "string" ? w.action_config.flowName : undefined;
      if (candidate) {
        flowName = candidate;
        break;
      }
    }
    if (!flowName) return null;

    const p = payload as Record<string, unknown>;
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(payload ?? {}))
      .digest("hex")
      .slice(0, 16);
    const externalId = typeof p?.id === "string" ? p.id : `${source.id}-${payloadHash}`;

    return {
      sourceId: source.id,
      externalId,
      type: "new",
      flowName,
      payload: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {},
    };
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
