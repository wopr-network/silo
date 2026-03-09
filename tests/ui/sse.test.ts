import { describe, expect, it, vi } from "vitest";
import { UiSseAdapter } from "../../src/ui/sse.js";
import type { ServerResponse } from "node:http";

function mockResponse(): ServerResponse & { chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    writeHead: vi.fn().mockReturnThis(),
    write: vi.fn((data: string) => {
      chunks.push(data);
      return true;
    }),
    end: vi.fn(),
    on: vi.fn(),
    headersSent: false,
  } as unknown as ServerResponse & { chunks: string[] };
}

describe("UiSseAdapter", () => {
  it("broadcasts engine events to connected SSE clients", async () => {
    const adapter = new UiSseAdapter();
    const res = mockResponse();
    adapter.addClient(res);

    await adapter.emit({
      type: "entity.created",
      entityId: "e1",
      flowId: "f1",
      payload: {},
      emittedAt: new Date("2026-01-01"),
    });

    expect(res.chunks.length).toBe(1);
    const data = res.chunks[0];
    expect(data).toContain("data:");
    expect(data).toContain("entity.created");
    expect(data).toContain("\n\n");
  });

  it("removes clients on close", async () => {
    const adapter = new UiSseAdapter();
    const res = mockResponse();
    let closeHandler: (() => void) | undefined;
    (res.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: () => void) => {
      if (event === "close") closeHandler = handler;
      return res;
    });

    adapter.addClient(res);
    expect(adapter.clientCount).toBe(1);

    closeHandler!();
    expect(adapter.clientCount).toBe(0);
  });
});
