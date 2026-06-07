import { zValidator } from "@hono/zod-validator";
import { SendMessageRequestSchema } from "@myagent/protocol";
import { Hono } from "hono";
import { buildContext, estimateTokenCount } from "../agent/context.js";
import { config } from "../config.js";
import { createLLMProvider } from "../llm/providers/factory.js";
import type { NormalizedMessage } from "../llm/types/message.js";
import { formatSSEEvent, mapToClientEvent } from "../relay/sse-relay.js";
import {
  addMessage,
  getSession,
  incrementMessageCount,
  updateSessionState,
} from "../store/session-store.js";

export const chatRoute = new Hono();

const DEFAULT_MAX_TOKENS = 128_000;

// POST /api/session/:id/chat - SSE 流式聊天
chatRoute.post("/:id/chat", zValidator("json", SendMessageRequestSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");
  const session = await getSession(id);

  if (!session) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "会话不存在" } }, 404);
  }

  const startTime = Date.now();
  console.log(`[Chat] 收到请求 sessionId=${id} contentLength=${body.content.length}`);

  // 构建 user 消息
  const userContent = [{ type: "text" as const, text: body.content }];
  const userMessage: NormalizedMessage = {
    role: "user",
    content: userContent,
  };

  // 持久化 user 消息
  const userTokenCount = estimateTokenCount(body.content);
  await addMessage(id, "user", JSON.stringify(userContent), userTokenCount);
  await updateSessionState(id, "streaming");
  await incrementMessageCount(id);

  // 构建上下文窗口
  let llmMessages: NormalizedMessage[];
  let systemPrompt: string | undefined;

  try {
    const ctx = await buildContext(id, userMessage, DEFAULT_MAX_TOKENS);

    llmMessages = ctx.messages;

    // 构建 system prompt（原始 systemPrompt + summary）
    const parts: string[] = [];
    if (ctx.systemPrompt) {
      parts.push(ctx.systemPrompt);
    }
    if (ctx.summary) {
      parts.push(`\n之前的对话摘要：${ctx.summary}`);
    }
    systemPrompt = parts.length > 0 ? parts.join("\n") : undefined;

    if (ctx.summary) {
      console.log(`[Context] 使用 Running Summary totalTokens=${ctx.totalTokens}`);
    }
  } catch (err) {
    console.error("[Context] 构建失败，使用单条消息:", err);
    llmMessages = [userMessage];
    systemPrompt = session.systemPrompt;
  }

  const llmProvider = createLLMProvider({
    provider: session.provider as "anthropic" | "ollama",
    apiKey: config.anthropicApiKey,
    baseUrl: session.provider === "ollama" ? config.ollamaBaseUrl : config.anthropicBaseUrl,
  });

  const model = session.model || config.defaultModel;

  // 用于取消上游 LLM 请求
  const abortController = new AbortController();

  // 监听客户端断开
  c.req.raw.signal.addEventListener(
    "abort",
    () => {
      abortController.abort();
    },
    { once: true },
  );

  const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const collectedUsage = { inputTokens: 0, outputTokens: 0 };
      let assistantText = "";

      try {
        console.log(`[LLM] 调用 provider=${session.provider} model=${model}`);

        for await (const event of llmProvider.stream({
          model,
          messages: llmMessages,
          maxTokens: 4096,
          system: systemPrompt,
          signal: abortController.signal,
        })) {
          if (abortController.signal.aborted) break;

          // 收集 usage
          if (event.type === "message_start") {
            collectedUsage.inputTokens = event.usage.inputTokens;
          }
          if (event.type === "message_delta") {
            collectedUsage.outputTokens = event.usage.outputTokens;
          }

          // 累积 assistant 文本
          if (event.type === "text_delta") {
            assistantText += event.text;
          }

          const clientEvent = mapToClientEvent(event);
          if (clientEvent) {
            controller.enqueue(encoder.encode(formatSSEEvent(clientEvent)));
          }
        }

        const duration = Date.now() - startTime;
        console.log(
          `[LLM] 流结束 outputTokens=${collectedUsage.outputTokens} duration=${duration}ms`,
        );

        // 持久化 assistant 消息
        if (assistantText) {
          const assistantContent = [{ type: "text" as const, text: assistantText }];
          const assistantTokenCount = estimateTokenCount(assistantText);
          await addMessage(id, "assistant", JSON.stringify(assistantContent), assistantTokenCount);
          await incrementMessageCount(id);
        }

        await updateSessionState(id, "idle");

        // 发送 done 事件
        controller.enqueue(
          encoder.encode(
            formatSSEEvent({
              type: "done",
              usage: {
                inputTokens: collectedUsage.inputTokens,
                outputTokens: collectedUsage.outputTokens,
              },
            }),
          ),
        );

        console.log(`[Chat] 响应完成 sessionId=${id}`);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // 客户端断开，正常
        } else {
          console.error(`[Error] chat sessionId=${id} error=`, err);
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            encoder.encode(
              formatSSEEvent({
                type: "error",
                code: "STREAM_ERROR",
                message,
                retryable: true,
              }),
            ),
          );
        }
        await updateSessionState(id, "idle");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
});
