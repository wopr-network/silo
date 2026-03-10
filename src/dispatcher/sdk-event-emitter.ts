import { query } from "@anthropic-ai/claude-agent-sdk";
import type { INukeEventEmitter, NukeEvent } from "./types.js";

type QueryOptions = NonNullable<Parameters<typeof query>[0]["options"]>;

export class SdkEventEmitter implements INukeEventEmitter {
  constructor(
    private prompt: string,
    private options: QueryOptions,
  ) {}

  async *events(): AsyncIterable<NukeEvent> {
    for await (const message of query({ prompt: this.prompt, options: this.options })) {
      if (message.type === "system") {
        yield { type: "system", subtype: message.subtype };
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            yield { type: "tool_use", name: block.name, input: block.input as Record<string, unknown> };
          } else if (block.type === "text" && block.text) {
            yield { type: "text", text: block.text };
          }
        }
      } else if (message.type === "result") {
        yield {
          type: "result",
          subtype: message.subtype,
          isError: message.is_error,
          stopReason: message.stop_reason ?? null,
          costUsd: message.total_cost_usd ?? null,
        };
      }
    }
  }
}
