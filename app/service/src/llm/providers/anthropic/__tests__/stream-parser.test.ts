import { describe, expect, it } from "vitest";
import { parseAnthropicStream } from "../stream-parser.js";

function createSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

describe("parseAnthropicStream", () => {
  it("解析 tool_use start、input_json_delta 和 stop reason", async () => {
    const stream = createSseStream([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":11,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"calculator","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":17"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":",\\"b\\":23,\\"operator\\":\\"*\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);

    const parsed = [];
    for await (const event of parseAnthropicStream(stream)) {
      parsed.push(event);
    }

    expect(parsed).toEqual([
      {
        type: "message_start",
        messageId: "msg_1",
        model: "claude",
        usage: { inputTokens: 11, outputTokens: 0 },
      },
      {
        type: "content_block_start",
        index: 0,
        blockType: "tool_use",
        toolCall: { id: "toolu_1", name: "calculator" },
      },
      { type: "tool_call_delta", index: 0, partialJson: '{"a":17' },
      { type: "tool_call_delta", index: 0, partialJson: ',"b":23,"operator":"*"}' },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", stopReason: "tool_use", usage: { outputTokens: 5 } },
      { type: "message_stop" },
    ]);
  });
});
