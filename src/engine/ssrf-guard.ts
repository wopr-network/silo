import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";

const DNS_CACHE_TTL_MS = 60_000;

interface DnsCacheEntry {
  ips: string[];
  expiresAt: number;
}

/** Exported for test access — clear between tests */
export const _dnsCache: Map<string, DnsCacheEntry> = new Map();

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
  /** Resolved IPs to use for the actual fetch (avoids DNS rebinding TOCTOU) */
  resolvedIps?: string[];
}

/**
 * Returns true if the IP address is in a private/reserved range.
 * Handles IPv4, IPv6 loopback, link-local, ULA, and IPv6-mapped IPv4.
 */
function isPrivateIp(ip: string): boolean {
  let normalized = ip;

  // Handle IPv6-mapped IPv4: ::ffff:A.B.C.D
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) {
    normalized = mapped[1];
  }

  // IPv6 loopback
  if (normalized === "::1") return true;

  // IPv6 link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;

  // IPv6 ULA fc00::/7 (addresses starting with fc or fd)
  if (/^f[cd]/i.test(normalized)) return true;

  // IPv4 checks
  const parts = normalized.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts.every((p) => p === 0)) return true;
  }

  return false;
}

/**
 * Parse CIDR notation and check if an IP falls within the range.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  if (!prefixStr) return false;
  const prefix = parseInt(prefixStr, 10);
  if (Number.isNaN(prefix)) return false;

  const baseParts = base.split(".").map(Number);
  const ipParts = ip.split(".").map(Number);
  if (baseParts.length !== 4 || ipParts.length !== 4) return false;

  // Validate prefix bounds for IPv4
  if (prefix < 0 || prefix > 32) return false;

  const baseNum = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];
  const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const mask = prefix === 0 ? 0 : ~0 << (32 - prefix);
  return (baseNum & mask) === (ipNum & mask);
}

/**
 * Resolve hostname to IP addresses, using cache with 60s TTL.
 */
async function resolveHost(hostname: string): Promise<string[]> {
  const cached = _dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ips;
  }

  const ips: string[] = [];
  try {
    const v4 = await resolve4(hostname);
    ips.push(...v4);
  } catch {
    // no A records
  }
  try {
    const v6 = await resolve6(hostname);
    ips.push(...v6);
  } catch {
    // no AAAA records
  }

  _dnsCache.set(hostname, { ips, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
  return ips;
}

/**
 * Parse the DEFCON_GATE_ALLOWLIST env var value into hostname and CIDR entries.
 */
function parseAllowlist(allowlist: string): { hostnames: Set<string>; cidrs: string[] } {
  const hostnames = new Set<string>();
  const cidrs: string[] = [];
  for (const entry of allowlist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (entry.includes("/")) {
      cidrs.push(entry);
    } else {
      hostnames.add(entry);
    }
  }
  return { hostnames, cidrs };
}

/**
 * Check whether a URL is safe to fetch (not targeting private/reserved addresses).
 *
 * @param url - The full HTTPS URL to check
 * @param allowlistEnv - Optional comma-separated allowlist (pass process.env.DEFCON_GATE_ALLOWLIST)
 * @returns SsrfCheckResult indicating whether the request should proceed,
 *          including resolvedIps to use for the actual fetch to avoid DNS rebinding TOCTOU.
 */
export async function checkSsrf(url: string, allowlistEnv?: string): Promise<SsrfCheckResult> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Parse allowlist once and reuse both hostnames and cidrs
  const allowlist = allowlistEnv ? parseAllowlist(allowlistEnv) : null;

  // If allowlist is set and hostname is explicitly allowed, skip checks
  if (allowlist?.hostnames.has(hostname)) {
    return { allowed: true };
  }

  // If the hostname is an IP literal, check directly without DNS
  let ips: string[];
  if (isIP(hostname)) {
    ips = [hostname];
  } else {
    ips = await resolveHost(hostname);
    if (ips.length === 0) {
      return { allowed: false, reason: `SSRF_BLOCKED: ${hostname} is unresolvable` };
    }
  }

  // Check CIDR allowlist if present
  if (allowlist && allowlist.cidrs.length > 0) {
    const allIpsAllowed = ips.every((ip) => allowlist.cidrs.some((cidr) => ipInCidr(ip, cidr)));
    if (allIpsAllowed) {
      return { allowed: true, resolvedIps: ips };
    }
  }

  // Check all resolved IPs — block if ANY is private
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      return { allowed: false, reason: `SSRF_BLOCKED: ${hostname} resolves to private/reserved address ${ip}` };
    }
  }

  return { allowed: true, resolvedIps: ips };
}
