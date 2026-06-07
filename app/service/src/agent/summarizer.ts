import { config } from "../config.js";
import { createLLMProvider } from "../llm/providers/factory.js";
import type { NormalizedMessage } from "../llm/types/message.js";

const SUMMARY_SYSTEM_PROMPT =
  "你是一个对话摘要助手。请将对话历史压缩为简洁的摘要，保留关键事实（人名、数字、结论）、用户偏好和未完成的任务，使用第三方视角描述。";

export async function generateSummary(
  messages: NormalizedMessage[],
  existingSummary: string | null,
  llmConfig: { provider: "anthropic" | "ollama"; model: string },
): Promise<string> {
  if (messages.length === 0) {
    return existingSummary ?? "";
  }

  // 将消息序列化为文本
  const conversationText = messages
    .map((m) => {
      const role = m.role === "user" ? "用户" : "助手";
      const text = m.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(" ");
      return `${role}: ${text}`;
    })
    .join("\n");

  const existingSection = existingSummary
    ? `\n之前的对话摘要：${existingSummary}\n请将以下新对话与旧摘要合并。`
    : "";

  const prompt = `请将以下对话历史压缩为简洁的摘要。\n${existingSection}\n要求：\n- 保留关键事实（人名、数字、结论）\n- 保留用户偏好和未完成的任务\n- 不超过 200 字\n- 使用第三方视角描述\n\n对话历史：\n${conversationText}`;

  const provider = createLLMProvider({
    provider: llmConfig.provider,
    apiKey: config.anthropicApiKey,
    baseUrl: llmConfig.provider === "ollama" ? config.ollamaBaseUrl : config.anthropicBaseUrl,
  });

  const result = await provider.complete({
    model: llmConfig.model,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    system: SUMMARY_SYSTEM_PROMPT,
    maxTokens: 400,
  });

  return result.content.trim();
}
