import Anthropic from "@anthropic-ai/sdk";
import type { IAIProviderAdapter } from "./interfaces.js";

const DEFAULT_MODEL_MAP: Record<string, string> = {
  reasoning: "claude-opus-4-6",
  execution: "claude-sonnet-4-6",
  monitoring: "claude-haiku-4-5",
};

interface AnthropicAdapterConfig {
  apiKey: string;
  modelMap?: Record<string, string>;
}

export class AnthropicAdapter implements IAIProviderAdapter {
  private client: Anthropic;
  private modelMap: Record<string, string>;

  constructor(config: AnthropicAdapterConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.modelMap = { ...DEFAULT_MODEL_MAP, ...config.modelMap };
  }

  async invoke(prompt: string, config: { model: string }): Promise<{ content: string }> {
    const model = this.modelMap[config.model] ?? config.model;
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      return { content: textBlock && textBlock.type === "text" ? textBlock.text : "" };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error (${err.status}): ${err.message}`);
      }
      throw err;
    }
  }
}
