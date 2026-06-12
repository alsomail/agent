import type { StreamEvent, ToolDefinition } from "@myagent/protocol";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedMessage } from "../../llm/types/message.js";
import type { NormalizedStreamEvent } from "../../llm/types/normalized.js";
import type { LLMProvider } from "../../llm/types/provider.js";
import { createToolRegistry } from "../../tools/registry.js";
import type { ToolExecutor } from "../../tools/types.js";
import { runAgentLoop } from "../loop.js";

function createProvider(responses: NormalizedStreamEvent[][]): LLMProvider {
  const stream = vi.fn(async function* () {
    const next = responses.shift();
    if (!next) {
      throw new Error("missing mock response");
    }
    for (const event of next) {
      yield event;
    }
  });

  return {
    stream,
    complete: vi.fn(),
  };
}

function createTool(name: string, definition?: Partial<ToolExecutor>): ToolExecutor {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    } satisfies ToolDefinition["inputSchema"],
    async execute() {
      return { content: `${name} result`, isError: false };
    },
    ...definition,
  };
}

async function collectEvents(
  provider: LLMProvider,
  tools: ToolExecutor[],
  messages: NormalizedMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  maxIterations?: number,
) {
  const events: StreamEvent[] = [];
  const result = await runAgentLoop({
    provider,
    registry: createToolRegistry(tools),
    messages,
    model: "test-model",
    sessionId: "session-1",
    maxTokens: 512,
    maxIterations,
    onEvent(event) {
      events.push(event);
    },
  });

  return { events, result };
}

describe("runAgentLoop", () => {
  it("纯文本回复会完成并持久化 assistant 文本", async () => {
    const provider = createProvider([
      [
        {
          type: "message_start",
          messageId: "msg_1",
          model: "test",
          usage: { inputTokens: 3, outputTokens: 0 },
        },
        { type: "content_block_start", index: 0, blockType: "text" },
        { type: "text_delta", index: 0, text: "hello" },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", stopReason: "end_turn", usage: { outputTokens: 5 } },
        { type: "message_stop" },
      ],
    ]);

    const { events, result } = await collectEvents(provider, []);

    expect(events).toEqual([
      { type: "state_change", state: "streaming" },
      { type: "text_delta", text: "hello" },
      { type: "done", usage: { inputTokens: 3, outputTokens: 5 } },
      { type: "state_change", state: "completed" },
    ]);
    expect(result.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("执行工具并回填 tool_use 和 tool_result", async () => {
    const provider = createProvider([
      [
        {
          type: "message_start",
          messageId: "msg_1",
          model: "test",
          usage: { inputTokens: 4, outputTokens: 0 },
        },
        {
          type: "content_block_start",
          index: 0,
          blockType: "tool_use",
          toolCall: { id: "toolu_1", name: "calculator" },
        },
        { type: "tool_call_delta", index: 0, partialJson: '{"a":17,"b":23,"operator":"*"}' },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", stopReason: "tool_use", usage: { outputTokens: 7 } },
        { type: "message_stop" },
      ],
      [
        {
          type: "message_start",
          messageId: "msg_2",
          model: "test",
          usage: { inputTokens: 8, outputTokens: 0 },
        },
        { type: "content_block_start", index: 0, blockType: "text" },
        { type: "text_delta", index: 0, text: "391" },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", stopReason: "end_turn", usage: { outputTokens: 3 } },
        { type: "message_stop" },
      ],
    ]);

    const { events, result } = await collectEvents(provider, [
      createTool("calculator", {
        async execute(input) {
          expect(input).toEqual({ a: 17, b: 23, operator: "*" });
          return { content: "391", isError: false };
        },
      }),
    ]);

    expect(events).toEqual([
      { type: "state_change", state: "streaming" },
      { type: "tool_call_start", toolCallId: "toolu_1", toolName: "calculator" },
      {
        type: "tool_call_delta",
        toolCallId: "toolu_1",
        partialJson: '{"a":17,"b":23,"operator":"*"}',
      },
      { type: "state_change", state: "tool_executing" },
      {
        type: "tool_result",
        toolCallId: "toolu_1",
        toolName: "calculator",
        result: "391",
        isError: false,
      },
      { type: "state_change", state: "streaming" },
      { type: "text_delta", text: "391" },
      { type: "done", usage: { inputTokens: 12, outputTokens: 10 } },
      { type: "state_change", state: "completed" },
    ]);
    expect(result.messages).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "calculator",
            input: { a: 17, b: 23, operator: "*" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "toolu_1", content: "391", isError: false }],
      },
      { role: "assistant", content: [{ type: "text", text: "391" }] },
    ]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("工具参数 JSON 错误时返回可见 error", async () => {
    const provider = createProvider([
      [
        {
          type: "message_start",
          messageId: "msg_1",
          model: "test",
          usage: { inputTokens: 4, outputTokens: 0 },
        },
        {
          type: "content_block_start",
          index: 0,
          blockType: "tool_use",
          toolCall: { id: "toolu_1", name: "calculator" },
        },
        { type: "tool_call_delta", index: 0, partialJson: '{"a":17' },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", stopReason: "tool_use", usage: { outputTokens: 7 } },
        { type: "message_stop" },
      ],
    ]);

    const { events, result } = await collectEvents(provider, [createTool("calculator")]);

    expect(events.at(-2)).toEqual({
      type: "error",
      code: "TOOL_INPUT_PARSE_ERROR",
      message: expect.stringMatching(/toolu_1/),
      retryable: false,
    });
    expect(events.at(-1)).toEqual({ type: "state_change", state: "error" });
    expect(result.messages).toEqual([]);
    expect(result.state).toBe("error");
    expect(result.stopReason).toBe("tool_use");
  });

  it("未知工具名返回 tool_result 错误", async () => {
    const provider = createProvider([
      [
        {
          type: "message_start",
          messageId: "msg_1",
          model: "test",
          usage: { inputTokens: 4, outputTokens: 0 },
        },
        {
          type: "content_block_start",
          index: 0,
          blockType: "tool_use",
          toolCall: { id: "toolu_1", name: "unknown_tool" },
        },
        { type: "tool_call_delta", index: 0, partialJson: '{"query":"x"}' },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", stopReason: "tool_use", usage: { outputTokens: 7 } },
        { type: "message_stop" },
      ],
      [
        {
          type: "message_start",
          messageId: "msg_2",
          model: "test",
          usage: { inputTokens: 2, outputTokens: 0 },
        },
        { type: "message_delta", stopReason: "end_turn", usage: { outputTokens: 1 } },
        { type: "message_stop" },
      ],
    ]);

    const { events } = await collectEvents(provider, []);

    expect(events).toContainEqual({
      type: "tool_result",
      toolCallId: "toolu_1",
      toolName: "unknown_tool",
      result: expect.stringMatching(/未知工具/),
      isError: true,
    });
  });

  it("超过 maxIterations 时返回可见终止原因", async () => {
    const provider = createProvider([
      [
        {
          type: "message_start",
          messageId: "msg_1",
          model: "test",
          usage: { inputTokens: 1, outputTokens: 0 },
        },
        {
          type: "content_block_start",
          index: 0,
          blockType: "tool_use",
          toolCall: { id: "toolu_1", name: "calculator" },
        },
        { type: "tool_call_delta", index: 0, partialJson: '{"a":1,"b":1,"operator":"+"}' },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", stopReason: "tool_use", usage: { outputTokens: 1 } },
        { type: "message_stop" },
      ],
    ]);

    const { events, result } = await collectEvents(
      provider,
      [createTool("calculator")],
      undefined,
      1,
    );

    expect(events.at(-2)).toEqual({
      type: "error",
      code: "MAX_ITERATIONS_EXCEEDED",
      message: expect.stringMatching(/1/),
      retryable: false,
    });
    expect(events.at(-1)).toEqual({ type: "state_change", state: "error" });
    expect(result.state).toBe("error");
    expect(result.stopReason).toBe("tool_use");
  });
});
