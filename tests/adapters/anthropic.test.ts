import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "../../src/adapters/anthropic.js";
import type { IAIProviderAdapter } from "../../src/adapters/interfaces.js";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class Anthropic {
      messages = { create: createMock };
      constructor(_opts: { apiKey: string }) {}
      static APIError = class extends Error {
        status: number;
        constructor(status: number, message: string) {
          super(message);
          this.status = status;
        }
      };
    },
  };
});

describe("AnthropicAdapter", () => {
  let adapter: IAIProviderAdapter;

  beforeEach(() => {
    createMock.mockReset();
    adapter = new AnthropicAdapter({ apiKey: "sk-test-key" });
  });

  it("implements IAIProviderAdapter", () => {
    expect(adapter).toHaveProperty("invoke");
    expect(typeof adapter.invoke).toBe("function");
  });

  it("invokes with default model mapping for 'reasoning' tier", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello from Claude" }],
    });

    const result = await adapter.invoke("Say hello", { model: "reasoning" });

    expect(result).toEqual({ content: "Hello from Claude" });
    expect(createMock).toHaveBeenCalledWith({
      model: "claude-opus-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: "Say hello" }],
    });
  });

  it("invokes with default model mapping for 'execution' tier", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Done" }],
    });

    const result = await adapter.invoke("Do something", { model: "execution" });

    expect(result).toEqual({ content: "Done" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6" }),
    );
  });

  it("invokes with default model mapping for 'monitoring' tier", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "OK" }],
    });

    const result = await adapter.invoke("Check status", { model: "monitoring" });

    expect(result).toEqual({ content: "OK" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" }),
    );
  });

  it("passes through unknown model names as-is", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hi" }],
    });

    const result = await adapter.invoke("Hello", { model: "claude-sonnet-4-6" });

    expect(result).toEqual({ content: "Hi" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6" }),
    );
  });

  it("uses custom modelMap override over defaults", async () => {
    const custom = new AnthropicAdapter({
      apiKey: "sk-test",
      modelMap: { reasoning: "claude-custom-model" },
    });

    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Custom" }],
    });

    const result = await custom.invoke("Think", { model: "reasoning" });

    expect(result).toEqual({ content: "Custom" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-custom-model" }),
    );
  });

  it("returns empty string when response has no text blocks", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "t1", name: "foo", input: {} }],
    });

    const result = await adapter.invoke("Use tool", { model: "execution" });

    expect(result).toEqual({ content: "" });
  });

  it("throws on API authentication error", async () => {
    createMock.mockRejectedValueOnce(new Error("Invalid API key"));

    await expect(adapter.invoke("Hi", { model: "execution" })).rejects.toThrow(
      /Invalid API key/,
    );
  });

  it("throws on rate limit error", async () => {
    createMock.mockRejectedValueOnce(new Error("Rate limit exceeded"));

    await expect(adapter.invoke("Hi", { model: "execution" })).rejects.toThrow(
      /Rate limit/,
    );
  });
});
