import { createHash, timingSafeEqual } from "node:crypto";

/** Timing-safe token comparison via SHA-256 digest. */
export function tokensMatch(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a.trim()).digest();
  const hashB = createHash("sha256").update(b.trim()).digest();
  return timingSafeEqual(hashA, hashB);
}

/** Extract a bearer token from an Authorization header value. */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const lower = header.toLowerCase();
  if (!lower.startsWith("bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}
