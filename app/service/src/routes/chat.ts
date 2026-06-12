import { zValidator } from "@hono/zod-validator";
import { SendMessageRequestSchema } from "@myagent/protocol";
import { Hono } from "hono";
import { buildContext, estimateTokenCount } from "../agent/context.js";
import { runAgentLoop } from "../agent/loop.js";
import { config } from "../config.js";
import { createLLMProvider } from "../llm/providers/factory.js";
import { hasOllamaModel } from "../llm/providers/ollama/client.js";
import type { NormalizedMessage } from "../llm/types/message.js";
import { downgradeModelCapabilitiesToUnstable } from "../models/capability-cache.js";
import { getModelCapabilities } from "../models/capability-probe.js";
import { formatSSEEvent } from "../relay/sse-relay.js";
import {
  addMessage,
  getSession,
  incrementMessageCount,
  updateSessionState,
} from "../store/session-store.js";
import { createBuiltInTools } from "../tools/built-in/index.js";
import { createToolRegistry } from "../tools/registry.js";
import { logger } from "../utils/logger.js";

export const chatRoute = new Hono();

const DEFAULT_MAX_TOKENS = 128_000;
const activeChatSessions = new Set<string>();

function buildDebugPayload(params: {
  sessionId: string;
  provider: "anthropic" | "ollama";
  model: string;
  systemPrompt?: string;
  messages: NormalizedMessage[];
  tools: ReturnType<ReturnType<typeof createToolRegistry>["definitions"]>;
  capabilityStatus?: string;
  currentUserText: string;
}) {
  const currentIndex = params.messages.length - 1;

  return {
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.model,
    system: params.systemPrompt ?? null,
    messageCount: params.messages.length,
    messages: params.messages.map((message, index) => ({
      index,
      origin: index === currentIndex ? "current_request" : "history",
      role: message.role,
      content: message.content,
      summary: summarizeMessage(message),
    })),
    tools: params.tools,
    capabilityStatus: params.capabilityStatus ?? null,
    currentUserText: params.currentUserText,
  };
}

function summarizeMessage(message: NormalizedMessage): string {
  return message.content
    .map((block) => {
      if (block.type === "text") {
        return `text:${block.text.slice(0, 80)}`;
      }

      if (block.type === "tool_use") {
        return `tool_use:${block.name}`;
      }

      return `tool_result:${block.toolUseId}:${block.content.slice(0, 80)}`;
    })
    .join(" | ");
}

function collectAssistantToolNames(messages: NormalizedMessage[]): string[] {
  const names = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const block of message.content) {
      if (block.type === "tool_use") {
        names.add(block.name);
      }
    }
  }

  return [...names];
}

function detectToolIntentWithoutCall(params: {
  messages: NormalizedMessage[];
  availableToolNames: string[];
}) {
  const assistantText = params.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (!assistantText.trim()) {
    return {
      detected: false,
      matchedTools: [],
    };
  }

  const normalizedText = assistantText.toLowerCase();
  const matchedTools = params.availableToolNames.filter((toolName) =>
    normalizedText.includes(toolName.toLowerCase()),
  );
  const hasToolUse = collectAssistantToolNames(params.messages).length > 0;
  const mentionsIntent =
    /应该使用|我会使用|我将使用|需要使用|应该调用|我会调用|我将调用|需要调用|调用.{0,40}工具|use tool|call tool|i should use|i should call/i.test(
      assistantText,
    );

  return {
    detected: !hasToolUse && matchedTools.length > 0 && mentionsIntent,
    matchedTools,
    preview: assistantText.slice(0, 200),
  };
}

// POST /api/session/:id/chat - SSE 流式聊天
chatRoute.post("/:id/chat", zValidator("json", SendMessageRequestSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");
  const session = await getSession(id);

  if (!session) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "会话不存在" } }, 404);
  }

  if (session.state !== "idle" && session.state !== "completed" && session.state !== "error") {
    if (!activeChatSessions.has(id)) {
      logger.warn("Recovering stale busy session", {
        sessionId: id,
        state: session.state,
        updatedAt: session.updatedAt,
      });
      await updateSessionState(id, "idle");
    } else {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "当前会话已有进行中的请求" } },
        409,
      );
    }
  }

  const recoveredSession = await getSession(id);
  if (!recoveredSession) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "会话不存在" } }, 404);
  }

  if (!recoveredSession.model) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "会话缺少可用模型配置" } },
      400,
    );
  }

  if (recoveredSession.provider === "ollama") {
    try {
      const matched = await hasOllamaModel(recoveredSession.model, config.ollamaBaseUrl);
      if (!matched) {
        return c.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: `当前会话使用的 Ollama 模型不存在: ${recoveredSession.model}`,
            },
          },
          400,
        );
      }
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "无法连接 Ollama 服务",
          },
        },
        502,
      );
    }
  }

  // 构建 user 消息
  const userContent = [{ type: "text" as const, text: body.content }];
  const userMessage: NormalizedMessage = {
    role: "user",
    content: userContent,
  };

  try {
    activeChatSessions.add(id);

    // 持久化 user 消息
    const userTokenCount = estimateTokenCount(body.content);
    await addMessage(id, "user", JSON.stringify(userContent), userTokenCount);
    await updateSessionState(id, "streaming");
    await incrementMessageCount(id);

    // 构建上下文窗口
    let llmMessages: NormalizedMessage[];
    let systemPrompt: string | undefined;

    try {
      const ctx = await buildContext(id, DEFAULT_MAX_TOKENS);

      llmMessages = ctx.messages;

      const parts: string[] = [];
      if (ctx.systemPrompt) {
        parts.push(ctx.systemPrompt);
      }
      if (ctx.summary) {
        parts.push(`\n之前的对话摘要：${ctx.summary}`);
      }
      systemPrompt = parts.length > 0 ? parts.join("\n") : undefined;

      if (ctx.summary) {
        logger.info("Running summary applied", { sessionId: id, totalTokens: ctx.totalTokens });
      }
    } catch (err) {
      logger.error("Context build failed, fallback to single user message", {
        sessionId: id,
        message: err instanceof Error ? err.message : String(err),
      });
      llmMessages = [userMessage];
      systemPrompt = recoveredSession.systemPrompt;
    }

    const llmProvider = createLLMProvider({
      provider: recoveredSession.provider as "anthropic" | "ollama",
      apiKey: config.anthropicApiKey,
      baseUrl:
        recoveredSession.provider === "ollama" ? config.ollamaBaseUrl : config.anthropicBaseUrl,
    });
    const provider = recoveredSession.provider as "anthropic" | "ollama";
    const model = recoveredSession.model;
    const toolRegistry = createToolRegistry(createBuiltInTools());
    let toolDefinitions = toolRegistry.definitions();
    let capabilityStatus = provider === "anthropic" ? "supported" : "unknown";

    let modelCapabilityIdentity:
      | Awaited<ReturnType<typeof getModelCapabilities>>["capabilities"]["identity"]
      | undefined;

    if (provider === "ollama") {
      try {
        const capability = await getModelCapabilities({
          provider: "ollama",
          model,
          forceRefresh: false,
        });
        modelCapabilityIdentity = capability.capabilities.identity;
        capabilityStatus = capability.capabilities.tools.status;
        toolDefinitions =
          capability.capabilities.tools.status === "supported" ? toolDefinitions : [];
      } catch (error) {
        capabilityStatus = "error";
        toolDefinitions = [];
        logger.warn("Model capability lookup failed before chat", {
          sessionId: id,
          model,
          provider,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug("Outbound chat payload", {
      sessionId: id,
      payload: buildDebugPayload({
        sessionId: id,
        provider,
        model,
        systemPrompt,
        messages: llmMessages,
        tools: toolDefinitions,
        capabilityStatus,
        currentUserText: body.content,
      }),
    });

    const abortController = new AbortController();

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

        try {
          const result = await runAgentLoop({
            provider: llmProvider,
            registry: toolRegistry,
            messages: llmMessages,
            model,
            sessionId: id,
            maxTokens: 4096,
            maxIterations: 5,
            system: systemPrompt,
            signal: abortController.signal,
            tools: toolDefinitions,
            onEvent: async (event) => {
              if (event.type === "state_change") {
                await updateSessionState(id, event.state === "completed" ? "idle" : event.state);
              }

              if (!abortController.signal.aborted) {
                controller.enqueue(encoder.encode(formatSSEEvent(event)));
              }
            },
          });

          logger.debug("Agent result messages", {
            sessionId: id,
            state: result.state,
            stopReason: result.stopReason,
            usage: result.usage,
            diagnostics: {
              assistantToolCalls: collectAssistantToolNames(result.messages),
              toolIntentWithoutCall: detectToolIntentWithoutCall({
                messages: result.messages,
                availableToolNames: toolDefinitions.map((tool) => tool.name),
              }),
            },
            messages: result.messages.map((message, index) => ({
              index,
              role: message.role,
              content: message.content,
              summary: summarizeMessage(message),
            })),
          });

          const toolIntentDiagnosis = detectToolIntentWithoutCall({
            messages: result.messages,
            availableToolNames: toolDefinitions.map((tool) => tool.name),
          });

          if (toolIntentDiagnosis.detected) {
            logger.warn("Tool intent detected without actual tool call", {
              sessionId: id,
              model,
              provider,
              stopReason: result.stopReason,
              matchedTools: toolIntentDiagnosis.matchedTools,
              preview: toolIntentDiagnosis.preview,
            });

            if (
              provider === "ollama" &&
              capabilityStatus === "supported" &&
              toolDefinitions.length > 0 &&
              modelCapabilityIdentity
            ) {
              await downgradeModelCapabilitiesToUnstable({
                identity: modelCapabilityIdentity,
                reason:
                  "Model mentioned tool usage in text during chat but returned no structured tool_calls.",
              });
            }
          }

          for (const message of result.messages) {
            const serialized = JSON.stringify(message.content);
            const textForEstimate = message.content
              .map((block) => {
                if (block.type === "text") return block.text;
                if (block.type === "tool_use") return JSON.stringify(block.input);
                return block.content;
              })
              .join("\n");

            await addMessage(
              id,
              message.role,
              serialized,
              textForEstimate ? estimateTokenCount(textForEstimate) : undefined,
            );
            await incrementMessageCount(id);
          }

          await updateSessionState(id, "idle");
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            await updateSessionState(id, "aborted");
          } else {
            const message = err instanceof Error ? err.message : String(err);
            logger.error("Chat stream failed", { sessionId: id, message });
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
            controller.enqueue(
              encoder.encode(formatSSEEvent({ type: "state_change", state: "error" })),
            );
          }
          await updateSessionState(id, "idle");
        } finally {
          activeChatSessions.delete(id);
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
  } catch (err) {
    activeChatSessions.delete(id);
    await updateSessionState(id, "idle").catch(() => undefined);
    throw err;
  }
});
