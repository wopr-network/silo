import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordEventBusAdapter } from "../../src/adapters/discord.js";
import type { EngineEvent } from "../../src/adapters/interfaces.js";

describe("DiscordEventBusAdapter", () => {
  let adapter: DiscordEventBusAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    adapter = new DiscordEventBusAdapter(
      {
        token: "test-bot-token",
        routes: {
          "entity.created": { channel: "111111111111111111" },
          "entity.transitioned": { channel: "222222222222222222" },
        },
      },
      mockFetch,
    );
  });

  it("sends embed to correct channel for routed event", async () => {
    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: { refs: null },
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/111111111111111111/messages");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Bot test-bot-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toBe("entity.created");
    expect(body.embeds[0].color).toBe(0x2ecc71);
  });

  it("uses red color for failure events", async () => {
    const event: EngineEvent = {
      type: "invocation.failed",
      entityId: "ent-1",
      invocationId: "inv-1",
      error: "timeout",
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    adapter = new DiscordEventBusAdapter(
      {
        token: "test-bot-token",
        routes: {
          "invocation.failed": { channel: "333333333333333333" },
        },
      },
      mockFetch,
    );

    await adapter.emit(event);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.embeds[0].color).toBe(0xe74c3c);
  });

  it("silently drops unrouted events", async () => {
    const event: EngineEvent = {
      type: "gate.passed",
      entityId: "ent-1",
      gateId: "gate-1",
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await adapter.emit(event);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("logs error on fetch failure without throwing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const event: EngineEvent = {
      type: "entity.created",
      entityId: "ent-1",
      flowId: "flow-1",
      payload: {},
      emittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await expect(adapter.emit(event)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
