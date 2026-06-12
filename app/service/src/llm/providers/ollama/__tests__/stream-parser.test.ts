import { describe, expect, it } from "vitest";
import { parseOllamaStream } from "../stream-parser.js";
import type { OllamaChunk } from "../types.js";

function createByteStream(chunks: OllamaChunk[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = chunks
    .map((chunk) => JSON.stringify(chunk))
    .join("\n")
    .concat("\n");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

describe("parseOllamaStream", () => {
  it("为纯文本回复补齐 text content block 事件", async () => {
    const stream = createByteStream([
      {
        model: "qwen",
        created_at: "2026-06-11T14:00:00Z",
        message: {
          role: "assistant",
          content: "你好",
        },
        done: false,
      },
      {
        model: "qwen",
        created_at: "2026-06-11T14:00:01Z",
        message: {
          role: "assistant",
          content: "，很高兴见到你。",
        },
        done: true,
        done_reason: "stop",
        eval_count: 12,
      },
    ]);

    const events = [];
    for await (const event of parseOllamaStream(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content_block_start", index: 0, blockType: "text" },
      { type: "text_delta", index: 0, text: "你好" },
      { type: "text_delta", index: 0, text: "，很高兴见到你。" },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        stopReason: "end_turn",
        usage: { outputTokens: 12 },
      },
      { type: "message_stop" },
    ]);
  });
});
