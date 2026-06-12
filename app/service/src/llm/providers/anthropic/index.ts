import type {
  LLMCompleteParams,
  LLMCompleteResult,
  LLMProvider,
  LLMStreamParams,
} from "../../types/provider.js";
import { callAnthropicStream } from "./client.js";
import { toAnthropicMessages } from "./mapper.js";
import { parseAnthropicStream } from "./stream-parser.js";
import type { AnthropicToolDefinition } from "./types.js";

export function createAnthropicProvider(config: {
  apiKey: string;
  baseUrl?: string;
}): LLMProvider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com";

  return {
    async *stream(params: LLMStreamParams) {
      const messages = toAnthropicMessages(params.messages);

      const body = {
        model: params.model,
        max_tokens: params.maxTokens,
        messages,
        stream: true as const,
        ...(params.system ? { system: params.system } : {}),
        ...(params.tools ? { tools: toAnthropicTools(params.tools) } : {}),
      };

      const byteStream = await callAnthropicStream(body, config.apiKey, params.signal, baseUrl);

      yield* parseAnthropicStream(byteStream);
    },

    async complete(params: LLMCompleteParams): Promise<LLMCompleteResult> {
      const messages = toAnthropicMessages(params.messages);

      const body = {
        model: params.model,
        max_tokens: params.maxTokens ?? 1024,
        messages,
        stream: false as const,
        ...(params.system ? { system: params.system } : {}),
      };

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(`Anthropic API error: ${response.status} ${JSON.stringify(errorBody)}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      const textContent = data.content
        .filter(
          (c): c is { type: "text"; text: string } =>
            c.type === "text" && typeof c.text === "string",
        )
        .map((c) => c.text)
        .join("");

      return {
        content: textContent,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      };
    },
  };
}

function toAnthropicTools(tools: NonNullable<LLMStreamParams["tools"]>): AnthropicToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}
