import type { StreamEvent } from "@myagent/protocol";
import type {
  NormalizedMessage,
  ToolResultContentBlock,
  ToolUseContentBlock,
} from "../llm/types/message.js";
import type {
  ContentBlockStartEvent,
  MessageDeltaEvent,
  ToolCallDeltaEvent,
} from "../llm/types/normalized.js";
import type { LLMProvider } from "../llm/types/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutionResult } from "../tools/types.js";

const DEFAULT_MAX_ITERATIONS = 5;

interface AgentLoopParams {
  provider: LLMProvider;
  registry: ToolRegistry;
  messages: NormalizedMessage[];
  model: string;
  sessionId: string;
  maxTokens: number;
  maxIterations?: number;
  system?: string;
  signal?: AbortSignal;
  tools?: ReturnType<ToolRegistry["definitions"]>;
  onEvent(event: StreamEvent): void | Promise<void>;
}

interface PendingToolCall {
  id: string;
  name: string;
  index: number;
  partialJson: string;
}

interface StreamCollection {
  assistantMessage: NormalizedMessage | null;
  toolCalls: Array<ToolUseContentBlock & { index: number }>;
  stopReason: MessageDeltaEvent["stopReason"];
  usage: { inputTokens: number; outputTokens: number };
  state: "ok" | "error";
}

export interface AgentLoopResult {
  messages: NormalizedMessage[];
  state: "completed" | "error" | "aborted";
  usage: { inputTokens: number; outputTokens: number };
  stopReason: MessageDeltaEvent["stopReason"];
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const persistedMessages: NormalizedMessage[] = [];
  let llmMessages = [...params.messages];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    await params.onEvent({ type: "state_change", state: "streaming" });

    const collected = await collectProviderResponse(params, llmMessages);
    usage.inputTokens += collected.usage.inputTokens;
    usage.outputTokens += collected.usage.outputTokens;

    if (params.signal?.aborted) {
      return {
        messages: persistedMessages,
        state: "aborted",
        usage,
        stopReason: collected.stopReason,
      };
    }

    if (collected.state === "error") {
      return {
        messages: persistedMessages,
        state: "error",
        usage,
        stopReason: collected.stopReason,
      };
    }

    if (collected.stopReason === "tool_use" && collected.toolCalls.length > 0) {
      if (collected.assistantMessage) {
        persistedMessages.push(collected.assistantMessage);
        llmMessages = [...llmMessages, collected.assistantMessage];
      }

      await params.onEvent({ type: "state_change", state: "tool_executing" });

      for (const toolCall of collected.toolCalls) {
        const toolResult = await executeToolCall(
          toolCall,
          params.registry,
          params.sessionId,
          params.signal,
        );
        const toolResultMessage: NormalizedMessage = {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolUseId: toolCall.id,
              content: toolResult.content,
              isError: toolResult.isError,
            } satisfies ToolResultContentBlock,
          ],
        };

        persistedMessages.push(toolResultMessage);
        llmMessages = [...llmMessages, toolResultMessage];
        await params.onEvent({
          type: "tool_result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: toolResult.content,
          isError: toolResult.isError,
        });
      }

      if (iteration === maxIterations - 1) {
        await params.onEvent({
          type: "error",
          code: "MAX_ITERATIONS_EXCEEDED",
          message: `工具调用超过最大循环次数 ${maxIterations}`,
          retryable: false,
        });
        await params.onEvent({ type: "state_change", state: "error" });
        return {
          messages: persistedMessages,
          state: "error",
          usage,
          stopReason: collected.stopReason,
        };
      }

      continue;
    }

    if (collected.assistantMessage) {
      persistedMessages.push(collected.assistantMessage);
    }

    await params.onEvent({ type: "done", usage });
    await params.onEvent({ type: "state_change", state: "completed" });
    return {
      messages: persistedMessages,
      state: "completed",
      usage,
      stopReason: collected.stopReason,
    };
  }

  await params.onEvent({
    type: "error",
    code: "MAX_ITERATIONS_EXCEEDED",
    message: `工具调用超过最大循环次数 ${maxIterations}`,
    retryable: false,
  });
  await params.onEvent({ type: "state_change", state: "error" });
  return {
    messages: persistedMessages,
    state: "error",
    usage,
    stopReason: "tool_use",
  };
}

async function collectProviderResponse(
  params: Omit<AgentLoopParams, "messages" | "sessionId">,
  messages: NormalizedMessage[],
): Promise<StreamCollection> {
  const pendingText = new Map<number, string>();
  const pendingTools = new Map<number, PendingToolCall>();
  const blockOrder: Array<{ type: "text"; index: number } | { type: "tool_use"; index: number }> =
    [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let stopReason: MessageDeltaEvent["stopReason"] = null;

  try {
    for await (const event of params.provider.stream({
      model: params.model,
      messages,
      maxTokens: params.maxTokens,
      system: params.system,
      tools: params.tools ?? params.registry.definitions(),
      signal: params.signal,
    })) {
      if (params.signal?.aborted) {
        break;
      }

      if (event.type === "message_start") {
        usage.inputTokens = event.usage.inputTokens;
        continue;
      }

      if (event.type === "content_block_start") {
        handleContentBlockStart(event, pendingText, pendingTools, blockOrder);
        if (event.blockType === "tool_use" && event.toolCall) {
          await params.onEvent({
            type: "tool_call_start",
            toolCallId: event.toolCall.id,
            toolName: event.toolCall.name,
          });
        }
        continue;
      }

      if (event.type === "text_delta") {
        pendingText.set(event.index, `${pendingText.get(event.index) ?? ""}${event.text}`);
        await params.onEvent({ type: "text_delta", text: event.text });
        continue;
      }

      if (event.type === "tool_call_delta") {
        appendToolDelta(event, pendingTools);
        const toolCallId = pendingTools.get(event.index)?.id;
        if (toolCallId) {
          await params.onEvent({
            type: "tool_call_delta",
            toolCallId,
            partialJson: event.partialJson,
          });
        }
        continue;
      }

      if (event.type === "message_delta") {
        stopReason = event.stopReason;
        usage.outputTokens = event.usage.outputTokens;
        continue;
      }

      if (event.type === "error") {
        await params.onEvent({
          type: "error",
          code: "LLM_ERROR",
          message: event.error.message,
          retryable: false,
        });
        await params.onEvent({ type: "state_change", state: "error" });
        return { assistantMessage: null, toolCalls: [], stopReason, usage, state: "error" };
      }
    }
  } catch (error) {
    await params.onEvent({
      type: "error",
      code: "STREAM_ERROR",
      message: error instanceof Error ? error.message : "LLM stream failed",
      retryable: true,
    });
    await params.onEvent({ type: "state_change", state: "error" });
    return { assistantMessage: null, toolCalls: [], stopReason, usage, state: "error" };
  }

  const parsedToolCalls = parsePendingToolCalls(pendingTools);
  if (!parsedToolCalls.ok) {
    await params.onEvent({
      type: "error",
      code: "TOOL_INPUT_PARSE_ERROR",
      message: parsedToolCalls.message,
      retryable: false,
    });
    await params.onEvent({ type: "state_change", state: "error" });
    return { assistantMessage: null, toolCalls: [], stopReason, usage, state: "error" };
  }

  const assistantMessage = buildAssistantMessage(
    blockOrder,
    pendingText,
    parsedToolCalls.toolCalls,
  );
  return {
    assistantMessage,
    toolCalls: parsedToolCalls.toolCalls,
    stopReason,
    usage,
    state: "ok",
  };
}

function handleContentBlockStart(
  event: ContentBlockStartEvent,
  pendingText: Map<number, string>,
  pendingTools: Map<number, PendingToolCall>,
  blockOrder: Array<{ type: "text" | "tool_use"; index: number }>,
): void {
  blockOrder.push({
    type: event.blockType,
    index: event.index,
  });

  if (event.blockType === "text") {
    pendingText.set(event.index, pendingText.get(event.index) ?? "");
    return;
  }

  if (!event.toolCall) {
    throw new Error(`Missing tool call metadata for index ${event.index}`);
  }

  pendingTools.set(event.index, {
    id: event.toolCall.id,
    name: event.toolCall.name,
    index: event.index,
    partialJson: "",
  });
}

function appendToolDelta(
  event: ToolCallDeltaEvent,
  pendingTools: Map<number, PendingToolCall>,
): void {
  const pending = pendingTools.get(event.index);
  if (!pending) {
    return;
  }

  pendingTools.set(event.index, {
    ...pending,
    partialJson: `${pending.partialJson}${event.partialJson}`,
  });
}

function parsePendingToolCalls(
  pendingTools: Map<number, PendingToolCall>,
):
  | { ok: true; toolCalls: Array<ToolUseContentBlock & { index: number }> }
  | { ok: false; message: string } {
  const toolCalls: Array<ToolUseContentBlock & { index: number }> = [];

  for (const pending of pendingTools.values()) {
    try {
      const parsed = JSON.parse(pending.partialJson || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, message: `工具 ${pending.id} 的输入必须是 object JSON` };
      }
      toolCalls.push({
        type: "tool_use",
        id: pending.id,
        name: pending.name,
        input: parsed,
        index: pending.index,
      });
    } catch {
      return { ok: false, message: `无法解析工具 ${pending.id} 的输入 JSON` };
    }
  }

  return {
    ok: true,
    toolCalls: toolCalls.sort((left, right) => left.index - right.index),
  };
}

function buildAssistantMessage(
  blockOrder: Array<{ type: "text" | "tool_use"; index: number }>,
  pendingText: Map<number, string>,
  toolCalls: Array<ToolUseContentBlock & { index: number }>,
): NormalizedMessage | null {
  const toolCallMap = new Map(toolCalls.map((toolCall) => [toolCall.index, toolCall]));
  const content: NormalizedMessage["content"] = [];

  for (const block of blockOrder) {
    if (block.type === "text") {
      const text = pendingText.get(block.index) ?? "";
      if (text) {
        content.push({ type: "text", text });
      }
      continue;
    }

    const toolCall = toolCallMap.get(block.index);
    if (toolCall) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });
    }
  }

  if (content.length === 0) {
    return null;
  }

  return {
    role: "assistant",
    content,
  };
}

async function executeToolCall(
  toolCall: ToolUseContentBlock,
  registry: ToolRegistry,
  sessionId: string,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const tool = registry.get(toolCall.name);
  if (!tool) {
    return {
      content: `未知工具: ${toolCall.name}`,
      isError: true,
    };
  }

  try {
    return await tool.execute(toolCall.input, { sessionId, signal });
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "工具执行失败",
      isError: true,
    };
  }
}
