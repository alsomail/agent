import type { MessageDeltaEvent, NormalizedStreamEvent } from "../../types/normalized.js";
import type {
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockStopEvent,
  AnthropicErrorEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStartEvent,
  AnthropicMessageStopEvent,
  AnthropicRawStreamEvent,
} from "./types.js";

export async function* parseAnthropicStream(
  byteStream: ReadableStream<Uint8Array>,
): AsyncIterable<NormalizedStreamEvent> {
  let buffer = "";
  const reader = byteStream.pipeThrough(new TextDecoderStream()).getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // 按 \n\n 分割事件块
    while (buffer.includes("\n\n")) {
      const eventEndIndex = buffer.indexOf("\n\n");
      const eventBlock = buffer.substring(0, eventEndIndex);
      buffer = buffer.substring(eventEndIndex + 2);

      // 提取 event: 行
      const eventTypeMatch = eventBlock.match(/^event:\s*(.+)$/m);
      const eventType = eventTypeMatch?.[1]?.trim();
      if (!eventType || eventType === "ping") continue;

      // 提取 data: 行
      const dataMatch = eventBlock.match(/^data:\s*(.+)$/m);
      if (!dataMatch) continue;

      const parsed = JSON.parse(dataMatch[1]) as AnthropicRawStreamEvent;

      // 映射到归一化事件
      const normalized = mapToNormalized(parsed);
      if (normalized) yield normalized;
    }
  }
}

function mapToNormalized(event: AnthropicRawStreamEvent): NormalizedStreamEvent | null {
  switch (event.type) {
    case "message_start":
      return mapMessageStart(event);
    case "content_block_start":
      return mapContentBlockStart(event);
    case "content_block_delta":
      return mapContentBlockDelta(event);
    case "content_block_stop":
      return mapContentBlockStop(event);
    case "message_delta":
      return mapMessageDelta(event);
    case "message_stop":
      return { type: "message_stop" };
    case "error":
      return mapError(event);
    default:
      return null;
  }
}

function mapMessageStart(e: AnthropicMessageStartEvent): NormalizedStreamEvent {
  return {
    type: "message_start",
    messageId: e.message.id,
    model: e.message.model,
    usage: {
      inputTokens: e.message.usage.input_tokens,
      outputTokens: e.message.usage.output_tokens,
    },
  };
}

function mapContentBlockStart(e: AnthropicContentBlockStartEvent): NormalizedStreamEvent {
  const block = e.content_block;
  // 使用可变方式构建，但整体是不可变返回
  if (block.type === "tool_use") {
    return {
      type: "content_block_start",
      index: e.index,
      blockType: "tool_use",
      toolCall: { id: block.id, name: block.name },
    };
  }
  return {
    type: "content_block_start",
    index: e.index,
    blockType: "text",
  };
}

function mapContentBlockDelta(e: AnthropicContentBlockDeltaEvent): NormalizedStreamEvent {
  if (e.delta.type === "text_delta") {
    return { type: "text_delta", index: e.index, text: e.delta.text };
  }
  return {
    type: "tool_call_delta",
    index: e.index,
    partialJson: e.delta.partial_json,
  };
}

function mapContentBlockStop(e: AnthropicContentBlockStopEvent): NormalizedStreamEvent {
  return { type: "content_block_stop", index: e.index };
}

function mapMessageDelta(e: AnthropicMessageDeltaEvent): NormalizedStreamEvent {
  return {
    type: "message_delta",
    stopReason: (e.delta.stop_reason as MessageDeltaEvent["stopReason"]) ?? null,
    usage: { outputTokens: e.usage.output_tokens },
  };
}

// mapMessageStop 通过 mapToNormalized switch 直接返回，无需单独函数

function mapError(e: AnthropicErrorEvent): NormalizedStreamEvent {
  return { type: "error", error: e.error };
}
