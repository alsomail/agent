import type { NormalizedStreamEvent } from "../../types/normalized.js";
import type { OllamaChunk } from "./types.js";

export async function* parseOllamaStream(
  byteStream: ReadableStream<Uint8Array>,
): AsyncIterable<NormalizedStreamEvent> {
  let buffer = "";
  let emittedToolCalls = false;
  let emittedTextBlock = false;
  const reader = byteStream.pipeThrough(new TextDecoderStream()).getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // NDJSON: 按 \n 分割（不像 Anthropic SSE 按 \n\n 分割！）
    while (buffer.includes("\n")) {
      const newlineIdx = buffer.indexOf("\n");
      const line = buffer.substring(0, newlineIdx).trim();
      buffer = buffer.substring(newlineIdx + 1);

      if (line.length === 0) continue;

      const chunk = JSON.parse(line) as OllamaChunk;

      if (chunk.message.tool_calls?.length) {
        emittedToolCalls = true;
        for (const [index, toolCall] of chunk.message.tool_calls.entries()) {
          yield {
            type: "content_block_start",
            index,
            blockType: "tool_use",
            toolCall: {
              id: `ollama-tool-${index}`,
              name: toolCall.function.name,
            },
          };
          yield {
            type: "tool_call_delta",
            index,
            partialJson: JSON.stringify(toolCall.function.arguments),
          };
          yield {
            type: "content_block_stop",
            index,
          };
        }
      }

      // 有文本内容 → yield text_delta
      if (chunk.message.content) {
        if (!emittedTextBlock) {
          emittedTextBlock = true;
          yield {
            type: "content_block_start",
            index: 0,
            blockType: "text",
          };
        }
        yield {
          type: "text_delta",
          index: 0,
          text: chunk.message.content,
        };
      }

      // 流结束 → yield message_delta + message_stop
      if (chunk.done) {
        if (emittedTextBlock) {
          yield {
            type: "content_block_stop",
            index: 0,
          };
        }
        yield {
          type: "message_delta",
          stopReason:
            chunk.done_reason === "stop" ? (emittedToolCalls ? "tool_use" : "end_turn") : null,
          usage: {
            outputTokens: chunk.eval_count ?? 0,
          },
        };
        yield {
          type: "message_stop",
        };
      }
    }
  }
}
