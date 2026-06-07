import type {
  LLMCompleteParams,
  LLMCompleteResult,
  LLMProvider,
  LLMStreamParams,
} from "../../types/provider.js";
import { callOllamaChatStream } from "./client.js";
import { parseOllamaStream } from "./stream-parser.js";
import type { OllamaMessage } from "./types.js";

function toOllamaMessages(messages: LLMStreamParams["messages"]): OllamaMessage[] {
  return messages.map((msg) => {
    const textBlocks = msg.content.filter(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    const text = textBlocks.map((b) => b.text).join(" ");
    return { role: msg.role as "user" | "assistant", content: text };
  });
}

export function createOllamaProvider(config: {
  baseUrl?: string;
}): LLMProvider {
  const baseUrl = config.baseUrl ?? "http://localhost:11434";

  return {
    async *stream(params: LLMStreamParams) {
      const ollamaMessages = toOllamaMessages(params.messages);

      if (params.system) {
        ollamaMessages.unshift({ role: "system", content: params.system });
      }

      const byteStream = await callOllamaChatStream(
        { model: params.model, messages: ollamaMessages, stream: true },
        params.signal,
        baseUrl,
      );

      yield* parseOllamaStream(byteStream);
    },

    async complete(params: LLMCompleteParams): Promise<LLMCompleteResult> {
      const ollamaMessages = toOllamaMessages(params.messages);

      if (params.system) {
        ollamaMessages.unshift({ role: "system", content: params.system });
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: params.model,
          messages: ollamaMessages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Ollama API error: ${response.status} ${errorBody}`);
      }

      const data = (await response.json()) as {
        message?: { content?: string };
        eval_count?: number;
        prompt_eval_count?: number;
      };

      return {
        content: data.message?.content ?? "",
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
      };
    },
  };
}
