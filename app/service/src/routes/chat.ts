import { zValidator } from "@hono/zod-validator";
import { SendMessageRequestSchema } from "@myagent/protocol";
import { Hono } from "hono";
import { config } from "../config.js";
import { createLLMProvider } from "../llm/providers/factory.js";
import type { NormalizedMessage } from "../llm/types/message.js";
import { formatSSEEvent, mapToClientEvent } from "../relay/sse-relay.js";
import { sessionStore, systemPromptStore } from "../store/session-store.js";

export const chatRoute = new Hono();

// POST /api/session/:id/chat - SSE 流式聊天
chatRoute.post("/:id/chat", zValidator("json", SendMessageRequestSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");
  const session = sessionStore.get(id);

  if (!session) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "会话不存在" },
      },
      404,
    );
  }

  const startTime = Date.now();
  console.log(`[Chat] 收到请求 sessionId=${id} contentLength=${body.content.length}`);

  // 构建 normalized 消息
  const userMessage: NormalizedMessage = {
    role: "user",
    content: [{ type: "text", text: body.content }],
  };

  const llmProvider = createLLMProvider({
    provider: (session.provider as "anthropic" | "ollama") ?? config.provider,
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

      try {
        // 发送开始状态
        controller.enqueue(
          encoder.encode(formatSSEEvent({ type: "state_change", state: "streaming" })),
        );

        console.log(`[LLM] 调用 provider=${session.provider} model=${model}`);
        let streamStarted = false;

        const systemPrompt = systemPromptStore.get(id);

        for await (const event of llmProvider.stream({
          model,
          messages: [userMessage],
          maxTokens: 4096,
          system: systemPrompt,
          signal: abortController.signal,
        })) {
          if (abortController.signal.aborted) break;

          if (!streamStarted && event.type === "message_start") {
            streamStarted = true;
            console.log(`[LLM] 流开始 messageId=${event.messageId}`);
          }

          // 收集 usage
          if (event.type === "message_start") {
            collectedUsage.inputTokens = event.usage.inputTokens;
          }
          if (event.type === "message_delta") {
            collectedUsage.outputTokens = event.usage.outputTokens;
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
      } finally {
        // 更新会话
        const currentSession = sessionStore.get(id);
        if (currentSession) {
          currentSession.updatedAt = new Date().toISOString();
          currentSession.messageCount += 2; // user + assistant
        }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
});
