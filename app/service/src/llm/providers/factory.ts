import type { LLMProvider } from "../types/provider.js";
import type { LLMConfig } from "../types/provider.js";
import { createAnthropicProvider } from "./anthropic/index.js";

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
