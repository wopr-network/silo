import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { WebhookEventBusAdapter } from "../../src/adapters/webhook.js";
import type { EngineEvent } from "../../src/adapters/interfaces.js";

describe("WebhookEventBusAdapter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  it("posts to matching endpoint", async () => {
    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["entity.created"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("matches glob patterns (entity.*)", async () => {
    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["entity.*"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.transitioned",
      entityId: "ent-1",
      flowId: "flow-1",
      fromState: "a",
      toState: "b",
      trigger: "go",
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not post to non-matching endpoints", async () => {
    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["invocation.*"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("includes HMAC signature when secret configured", async () => {
    const secret = "my-secret-key";
    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["entity.*"], secret },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);

    const [, opts] = mockFetch.mock.calls[0];
    const body = opts.body;
    const expectedSig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(opts.headers["X-Signature"]).toBe(expectedSig);
  });

  it("includes custom headers", async () => {
    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          {
            url: "https://example.com/hook",
            events: ["entity.*"],
            headers: { "X-Custom": "value" },
          },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-Custom"]).toBe("value");
  });

  it("retries once on 5xx then logs error", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["entity.*"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("succeeds on retry after initial 5xx", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["entity.*"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("logs error on fetch throw without propagating", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://example.com/hook", events: ["entity.*"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await expect(adapter.emit(event)).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("posts to multiple matching endpoints", async () => {
    const adapter = new WebhookEventBusAdapter(
      {
        endpoints: [
          { url: "https://a.com/hook", events: ["entity.*"] },
          { url: "https://b.com/hook", events: ["entity.created"] },
          { url: "https://c.com/hook", events: ["invocation.*"] },
        ],
      },
      mockFetch,
    );

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
