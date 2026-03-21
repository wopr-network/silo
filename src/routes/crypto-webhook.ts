/**
 * Crypto payment webhook route.
 * Receives payment confirmations from the shared crypto key server.
 * Delegates to platform-core's handleKeyServerWebhook for crediting.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CryptoWebhookDeps,
  type CryptoWebhookPayload,
  handleKeyServerWebhook,
} from "@wopr-network/platform-core/billing";
import { Hono } from "hono";
import { logger } from "../logger.js";

let _deps: CryptoWebhookDeps | undefined;
let _webhookSecret: string | undefined;

export function setCryptoWebhookDeps(deps: CryptoWebhookDeps, webhookSecret: string): void {
  _deps = deps;
  _webhookSecret = webhookSecret;
}

export const cryptoWebhookRoutes = new Hono();

cryptoWebhookRoutes.post("/", async (c) => {
  if (!_deps || !_webhookSecret) {
    return c.json({ error: "Crypto webhooks not configured" }, 503);
  }

  const body = await c.req.text();
  const sig = c.req.header("x-webhook-signature") ?? c.req.header("btcpay-sig") ?? "";
  const expected = `sha256=${createHmac("sha256", _webhookSecret).update(body).digest("hex")}`;
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: CryptoWebhookPayload;
  try {
    payload = JSON.parse(body) as CryptoWebhookPayload;
  } catch {
    return c.json({ error: "Malformed JSON body" }, 400);
  }
  logger.info("Crypto webhook received", JSON.stringify({ chargeId: payload.chargeId, status: payload.status }));

  const result = await handleKeyServerWebhook(_deps, payload);
  if (result.duplicate) {
    return c.json({ ok: true, duplicate: true });
  }

  return c.json({ ok: true, handled: result.handled, creditedCents: result.creditedCents });
});
