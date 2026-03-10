import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADERS: Record<string, string> = {
  github: "x-hub-signature-256",
  linear: "x-linear-signature",
};
const DEFAULT_SIGNATURE_HEADER = "x-webhook-signature";

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

export function getSignatureHeader(source: { type: string; config: Record<string, unknown> }): string {
  if (typeof source.config.signatureHeader === "string") {
    return source.config.signatureHeader.toLowerCase();
  }
  return SIGNATURE_HEADERS[source.type.toLowerCase()] ?? DEFAULT_SIGNATURE_HEADER;
}

export function verifyWebhookSignature(
  rawBody: string,
  secret: string,
  signatureHeaderValue: string | undefined,
): VerifyResult {
  if (!signatureHeaderValue) {
    return { valid: false, error: "Missing signature header" };
  }

  // Strip "sha256=" prefix if present (GitHub format)
  const signature = signatureHeaderValue.startsWith("sha256=") ? signatureHeaderValue.slice(7) : signatureHeaderValue;

  // Validate hex format before converting to prevent silent truncation
  if (!/^[0-9a-fA-F]+$/.test(signature) || signature.length % 2 !== 0) {
    return { valid: false, error: "Invalid signature" };
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: "Invalid signature" };
  }

  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true };
}
