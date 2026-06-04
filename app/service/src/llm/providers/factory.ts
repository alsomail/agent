import type { LLMProvider } from "../types/provider.js";
import type { LLMConfig } from "../types/provider.js";
import { createAnthropicProvider } from "./anthropic/index.js";
import { createOllamaProvider } from "./ollama/index.js";

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      if (!config.apiKey) {
        throw new Error("Anthropic API key is required");
      }
      return createAnthropicProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    case "ollama":
      return createOllamaProvider({
        baseUrl: config.baseUrl,
      });
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
