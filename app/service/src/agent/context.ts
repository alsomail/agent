import type { NormalizedMessage } from "../llm/types/message.js";
import type { LLMConfig } from "../llm/types/provider.js";
import { getMessages, getSession, getSummary, upsertSummary } from "../store/session-store.js";
import { generateSummary } from "./summarizer.js";
import { estimateMessageTokens, estimateTokenCount } from "./token.js";

export { estimateTokenCount, estimateMessageTokens } from "./token.js";

export interface ContextWindow {
  systemPrompt: string | undefined;
  summary: string | null;
  messages: NormalizedMessage[];
  totalTokens: number;
}

const DEFAULT_MAX_TOKENS = 128_000;

export async function buildContext(
  sessionId: string,
  newMessage: NormalizedMessage,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): Promise<ContextWindow> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`会话 ${sessionId} 不存在`);
  }

  const storedMessages = await getMessages(sessionId);

  // 将所有消息转为 NormalizedMessage
  const historyMessages: NormalizedMessage[] = storedMessages.map((m) => ({
    role: m.role,
    content: JSON.parse(m.content) as NormalizedMessage["content"],
  }));

  const allMessages = [...historyMessages, newMessage];

  // 计算总 token
  let systemTokens = 0;
  if (session.systemPrompt) {
    systemTokens = estimateTokenCount(session.systemPrompt);
  }

  let messageTokens = 0;
  for (const msg of allMessages) {
    messageTokens += estimateMessageTokens(msg);
  }

  const totalTokens = systemTokens + messageTokens;

  // 不超窗口 → 直接返回全部
  if (totalTokens <= maxTokens * 0.7) {
    return {
      systemPrompt: session.systemPrompt,
      summary: null,
      messages: allMessages,
      totalTokens,
    };
  }

  // 超窗口 → 触发压缩
  const existingSummary = await getSummary(sessionId);
  const keepTokenBudget = Math.floor(maxTokens * 0.4);

  // 从后往前保留最近消息
  const recentMessages: NormalizedMessage[] = [];
  let recentTokens = 0;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(allMessages[i]);
    if (recentTokens + tokens > keepTokenBudget) break;
    recentMessages.unshift(allMessages[i]);
    recentTokens += tokens;
  }

  // 旧消息用于生成摘要
  const oldMessages = allMessages.slice(0, allMessages.length - recentMessages.length);
  const oldSummaryText = existingSummary?.content ?? null;

  // 调用 LLM 生成新摘要
  const newSummary = await generateSummary(oldMessages, oldSummaryText, {
    provider: session.provider as "anthropic" | "ollama",
    model: session.model,
  });

  await upsertSummary(sessionId, newSummary, estimateTokenCount(newSummary));

  const summaryTokens = estimateTokenCount(newSummary);
  const finalTokens = systemTokens + summaryTokens + recentTokens;

  return {
    systemPrompt: session.systemPrompt,
    summary: newSummary,
    messages: recentMessages,
    totalTokens: finalTokens,
  };
}
