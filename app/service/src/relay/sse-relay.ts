import type { StreamEvent } from "@myagent/protocol";
import type { NormalizedStreamEvent } from "../llm/types/normalized.js";

// Phase 1 事件映射：内部 NormalizedStreamEvent → 客户端 StreamEvent
export function mapToClientEvent(event: NormalizedStreamEvent): StreamEvent | null {
  switch (event.type) {
    case "text_delta":
      return { type: "text_delta", text: event.text };

    case "message_stop":
      // message_stop 时不发事件——等 chat 路由统一发 done
      return null;

    case "content_block_start":
      if (event.blockType === "tool_use" && event.toolCall) {
        return {
          type: "tool_call_start",
          toolCallId: event.toolCall.id,
          toolName: event.toolCall.name,
        };
      }
      return null;

    case "error":
      return {
        type: "error",
        code: "LLM_ERROR",
        message: event.error.message,
        retryable: false,
      };

    // 以下事件 Phase 1 不转发
    case "message_start":
    case "message_delta":
    case "content_block_stop":
    case "tool_call_delta":
      return null;

    default:
      return null;
  }
}

// 将 StreamEvent 序列化为 SSE 行
export function formatSSEEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
