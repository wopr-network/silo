import { describe, expect, it, vi } from "vitest";
import { HonoSseAdapter } from "../../src/api/hono-server.js";

function mockController(): ReadableStreamDefaultController<string> & { chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    enqueue: vi.fn((data: string) => {
      chunks.push(data);
    }),
    close: vi.fn(),
    desiredSize: 1,
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController<string> & { chunks: string[] };
}

describe("HonoSseAdapter", () => {
  it("broadcasts engine events to connected controllers", async () => {
    const adapter = new HonoSseAdapter();
    const ctrl = mockController();
    adapter.addController(ctrl);

    await adapter.emit({
      type: "entity.created",
      entityId: "e1",
      flowId: "f1",
      payload: {},
      emittedAt: new Date("2026-01-01"),
    });

    expect(ctrl.chunks.length).toBe(1);
    const data = ctrl.chunks[0];
    expect(data).toContain("data:");
    expect(data).toContain("entity.created");
    expect(data).toContain("\n\n");
  });

  it("removes controllers", async () => {
    const adapter = new HonoSseAdapter();
    const ctrl = mockController();
    adapter.addController(ctrl);
    expect(adapter.clientCount).toBe(1);

    adapter.removeController(ctrl);
    expect(adapter.clientCount).toBe(0);
  });

  it("handles controller errors gracefully", async () => {
    const adapter = new HonoSseAdapter();
    const ctrl = mockController();
    (ctrl.enqueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("stream closed");
    });
    adapter.addController(ctrl);

    await adapter.emit({
      type: "entity.created",
      entityId: "e1",
      flowId: "f1",
      payload: {},
      emittedAt: new Date("2026-01-01"),
    });

    // Controller should be removed after error
    expect(adapter.clientCount).toBe(0);
  });
});
