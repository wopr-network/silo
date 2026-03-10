import { describe, expect, it, vi } from "vitest";
import { SdkEventEmitter } from "./sdk-event-emitter.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

import { query } from "@anthropic-ai/claude-agent-sdk";

const mockQuery = vi.mocked(query);

async function* makeStream(messages: object[]) {
  for (const m of messages) yield m;
}

async function collect(emitter: SdkEventEmitter) {
  const events = [];
  for await (const e of emitter.events()) events.push(e);
  return events;
}

describe("SdkEventEmitter", () => {
  it("yields system event", async () => {
    mockQuery.mockReturnValue(makeStream([{ type: "system", subtype: "init" }]) as ReturnType<typeof query>);
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toEqual([{ type: "system", subtype: "init" }]);
  });

  it("yields tool_use events from assistant content", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } }] },
        },
      ]) as ReturnType<typeof query>,
    );
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toEqual([{ type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } }]);
  });

  it("yields text events from assistant content, skips empty strings", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "hello" },
              { type: "text", text: "" },
            ],
          },
        },
      ]) as ReturnType<typeof query>,
    );
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toEqual([{ type: "text", text: "hello" }]);
  });

  it("yields result event", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", total_cost_usd: 0.005 },
      ]) as ReturnType<typeof query>,
    );
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toEqual([
      { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0.005 },
    ]);
  });

  it("normalises null stop_reason and total_cost_usd", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: "result", subtype: "error", is_error: true, stop_reason: null, total_cost_usd: null },
      ]) as ReturnType<typeof query>,
    );
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toEqual([{ type: "result", subtype: "error", isError: true, stopReason: null, costUsd: null }]);
  });

  it("silently ignores unknown message types", async () => {
    mockQuery.mockReturnValue(makeStream([{ type: "unknown_future" }]) as ReturnType<typeof query>);
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toHaveLength(0);
  });

  it("silently ignores unknown assistant content block types", async () => {
    mockQuery.mockReturnValue(
      makeStream([{ type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }] } }]) as ReturnType<
        typeof query
      >,
    );
    const events = await collect(new SdkEventEmitter("p", {}));
    expect(events).toHaveLength(0);
  });
});
