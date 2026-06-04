import type { LLMProvider, LLMStreamParams } from "../../types/provider.js";
import { callAnthropicStream } from "./client.js";
import { toAnthropicMessages } from "./mapper.js";
import { parseAnthropicStream } from "./stream-parser.js";

export function createAnthropicProvider(config: {
  apiKey: string;
  baseUrl?: string;
}): LLMProvider {
  return {
    async *stream(params: LLMStreamParams) {
      const messages = toAnthropicMessages(params.messages);

      const body = {
        model: params.model,
        max_tokens: params.maxTokens,
        messages,
        stream: true as const,
        ...(params.system ? { system: params.system } : {}),
      };

      const byteStream = await callAnthropicStream(
        body,
        config.apiKey,
        params.signal,
        config.baseUrl,
      );

      yield* parseAnthropicStream(byteStream);
    },
  };
}
