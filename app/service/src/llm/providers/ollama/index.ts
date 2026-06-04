import type { LLMProvider, LLMStreamParams } from "../../types/provider.js";
import { callOllamaChatStream } from "./client.js";
import { parseOllamaStream } from "./stream-parser.js";
import type { OllamaMessage } from "./types.js";

export function createOllamaProvider(config: {
  baseUrl?: string;
}): LLMProvider {
  return {
    async *stream(params: LLMStreamParams) {
      // 将归一化消息转为 Ollama 格式
      const ollamaMessages: OllamaMessage[] = [];

      for (const msg of params.messages) {
        // 提取文本内容
        const textBlocks = msg.content.filter((b) => b.type === "text");
        const text = textBlocks
          .map((b) => {
            if (b.type === "text") return b.text;
            return "";
          })
          .join(" ");

        if (text) {
          ollamaMessages.push({
            role: msg.role as "user" | "assistant",
            content: text,
          });
        }
      }

      // 如果有 system prompt，作为第一条消息插入（Ollama 方式）
      if (params.system) {
        ollamaMessages.unshift({
          role: "system",
          content: params.system,
        });
      }

      const byteStream = await callOllamaChatStream(
        {
          model: params.model,
          messages: ollamaMessages,
          stream: true,
        },
        params.signal,
        config.baseUrl,
      );

      yield* parseOllamaStream(byteStream);
    },
  };
}
