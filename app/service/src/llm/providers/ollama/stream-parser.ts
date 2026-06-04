import type { NormalizedStreamEvent } from "../../types/normalized.js";
import type { OllamaChunk } from "./types.js";

export async function* parseOllamaStream(
  byteStream: ReadableStream<Uint8Array>,
): AsyncIterable<NormalizedStreamEvent> {
  let buffer = "";
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

      // 有文本内容 → yield text_delta
      if (chunk.message.content) {
        yield {
          type: "text_delta",
          index: 0,
          text: chunk.message.content,
        };
      }

      // 流结束 → yield message_delta + message_stop
      if (chunk.done) {
        yield {
          type: "message_delta",
          stopReason: chunk.done_reason === "stop" ? "end_turn" : null,
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
