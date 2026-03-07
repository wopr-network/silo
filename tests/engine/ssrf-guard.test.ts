import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkSsrf, _dnsCache } from "../../src/engine/ssrf-guard.js";

// Mock dns/promises so tests don't do real DNS
vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

beforeEach(() => {
  _dnsCache.clear();
  vi.clearAllMocks();
  // Default: resolve to a public IP
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
});

describe("checkSsrf", () => {
  it("allows a public IP hostname", async () => {
    const result = await checkSsrf("https://example.com/api");
    expect(result.allowed).toBe(true);
  });

  it("blocks 169.254.169.254 (AWS metadata)", async () => {
    mockResolve4.mockResolvedValue(["169.254.169.254"]);
    const result = await checkSsrf("https://169.254.169.254/latest/meta-data/");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks 10.x.x.x (RFC 1918)", async () => {
    mockResolve4.mockResolvedValue(["10.0.0.1"]);
    const result = await checkSsrf("https://internal.corp/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks 172.16.x.x (RFC 1918)", async () => {
    mockResolve4.mockResolvedValue(["172.16.0.1"]);
    const result = await checkSsrf("https://internal.corp/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks 192.168.x.x (RFC 1918)", async () => {
    mockResolve4.mockResolvedValue(["192.168.1.1"]);
    const result = await checkSsrf("https://internal.corp/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks 127.0.0.1 (loopback)", async () => {
    mockResolve4.mockResolvedValue(["127.0.0.1"]);
    const result = await checkSsrf("https://localhost/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks ::1 (IPv6 loopback)", async () => {
    mockResolve4.mockRejectedValue(new Error("no A"));
    mockResolve6.mockResolvedValue(["::1"]);
    const result = await checkSsrf("https://localhost/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks fe80:: (link-local IPv6)", async () => {
    mockResolve4.mockRejectedValue(new Error("no A"));
    mockResolve6.mockResolvedValue(["fe80::1"]);
    const result = await checkSsrf("https://link-local.test/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks ::ffff:127.0.0.1 (IPv6-mapped IPv4 loopback)", async () => {
    mockResolve4.mockRejectedValue(new Error("no A"));
    mockResolve6.mockResolvedValue(["::ffff:127.0.0.1"]);
    const result = await checkSsrf("https://mapped.test/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks when ANY resolved IP is private (mixed resolution)", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34", "10.0.0.1"]);
    const result = await checkSsrf("https://sneaky.test/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks unresolvable hostnames", async () => {
    mockResolve4.mockRejectedValue(new Error("ENOTFOUND"));
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await checkSsrf("https://does-not-exist.invalid/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
    expect(result.reason).toContain("unresolvable");
  });

  it("allows host in DEFCON_GATE_ALLOWLIST even if private", async () => {
    mockResolve4.mockResolvedValue(["10.0.0.1"]);
    const result = await checkSsrf("https://internal.corp/api", "internal.corp,other.corp");
    expect(result.allowed).toBe(true);
  });

  it("allows IP in CIDR allowlist entry", async () => {
    mockResolve4.mockResolvedValue(["10.0.0.5"]);
    const result = await checkSsrf("https://internal.corp/api", "10.0.0.0/24");
    expect(result.allowed).toBe(true);
  });

  it("caches DNS results for 60s", async () => {
    await checkSsrf("https://example.com/api");
    await checkSsrf("https://example.com/other");
    expect(mockResolve4).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after cache TTL expires", async () => {
    await checkSsrf("https://example.com/api");
    // Manually expire the cache entry
    const entry = _dnsCache.get("example.com");
    if (entry) entry.expiresAt = Date.now() - 1;
    await checkSsrf("https://example.com/api");
    expect(mockResolve4).toHaveBeenCalledTimes(2);
  });

  it("handles IP address literal in URL (no DNS needed)", async () => {
    const result = await checkSsrf("https://93.184.216.34/api");
    expect(result.allowed).toBe(true);
    expect(mockResolve4).not.toHaveBeenCalled();
  });

  it("blocks IP address literal that is private", async () => {
    const result = await checkSsrf("https://10.0.0.1/api");
    expect(result.allowed).toBe(false);
    expect(mockResolve4).not.toHaveBeenCalled();
  });

  it("blocks fc00::/7 IPv6 ULA (fc prefix)", async () => {
    mockResolve4.mockRejectedValue(new Error("no A"));
    mockResolve6.mockResolvedValue(["fc00::1"]);
    const result = await checkSsrf("https://ula.test/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("blocks fc00::/7 IPv6 ULA (fd prefix)", async () => {
    mockResolve4.mockRejectedValue(new Error("no A"));
    mockResolve6.mockResolvedValue(["fd12:3456:789a::1"]);
    const result = await checkSsrf("https://ula2.test/api");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SSRF_BLOCKED");
  });

  it("returns resolvedIps in result for public hostname", async () => {
    const result = await checkSsrf("https://example.com/api");
    expect(result.allowed).toBe(true);
    expect(result.resolvedIps).toEqual(["93.184.216.34"]);
  });

  it("ipInCidr: rejects prefix > 32 (treats as non-matching, private IP still blocked)", async () => {
    mockResolve4.mockResolvedValue(["10.0.0.1"]);
    const result = await checkSsrf("https://internal.corp/api", "10.0.0.0/33");
    expect(result.allowed).toBe(false);
  });
});
