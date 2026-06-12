import type { ContentBlock, StreamEvent } from "@myagent/protocol";
import { describe, expect, it } from "vitest";
import {
  type ChatMessage,
  applyStreamEvent,
  createStreamingState,
  resolveRequestedModel,
  storedMessagesToChatMessages,
} from "../useChat.js";

function assistantMessage(id: string, content: ContentBlock[]): ChatMessage {
  return { id, role: "assistant", content };
}

describe("storedMessagesToChatMessages", () => {
  it("保留 text/tool_use/tool_result 内容块", () => {
    const messages = storedMessagesToChatMessages([
      {
        id: "1",
        role: "assistant",
        sessionId: "session-1",
        content: JSON.stringify([
          { type: "text", text: "让我算一下" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "calculator",
            input: { a: 8, b: 9, operator: "*" },
          },
        ]),
        createdAt: "2026-06-10T00:00:00.000Z",
      },
      {
        id: "2",
        role: "user",
        sessionId: "session-1",
        content: JSON.stringify([
          { type: "tool_result", toolUseId: "toolu_1", content: "72", isError: false },
        ]),
        createdAt: "2026-06-10T00:00:01.000Z",
      },
    ]);

    expect(messages).toEqual([
      assistantMessage("1", [
        { type: "text", text: "让我算一下" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "calculator",
          input: { a: 8, b: 9, operator: "*" },
        },
      ]),
      {
        id: "2",
        role: "user",
        content: [{ type: "tool_result", toolUseId: "toolu_1", content: "72", isError: false }],
      },
    ]);
  });
});

describe("applyStreamEvent", () => {
  it("处理工具调用事件并在 tool_result 时提交 assistant/user 消息", () => {
    const events: StreamEvent[] = [
      { type: "text_delta", text: "让我算一下" },
      { type: "tool_call_start", toolCallId: "toolu_1", toolName: "calculator" },
      {
        type: "tool_call_delta",
        toolCallId: "toolu_1",
        partialJson: '{"a":8,"b":9,"operator":"*"}',
      },
      { type: "state_change", state: "tool_executing" },
      {
        type: "tool_result",
        toolCallId: "toolu_1",
        toolName: "calculator",
        result: "72",
        isError: false,
      },
      { type: "state_change", state: "streaming" },
      { type: "text_delta", text: "小明，结果是 72" },
      { type: "done", usage: { inputTokens: 10, outputTokens: 12 } },
    ];

    const finalState = events.reduce(
      (state, event) => applyStreamEvent(state, event),
      createStreamingState(),
    );

    expect(finalState.messages).toEqual([
      {
        id: expect.any(String),
        role: "assistant",
        content: [
          { type: "text", text: "让我算一下" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "calculator",
            input: { a: 8, b: 9, operator: "*" },
          },
        ],
      },
      {
        id: expect.any(String),
        role: "user",
        content: [{ type: "tool_result", toolUseId: "toolu_1", content: "72", isError: false }],
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: [{ type: "text", text: "小明，结果是 72" }],
      },
    ]);
    expect(finalState.streamingText).toBe("");
    expect(finalState.pendingToolCalls).toEqual([]);
  });
});

describe("resolveRequestedModel", () => {
  it("忽略非字符串或空字符串的显式模型参数，回退到当前选择模型", () => {
    expect(resolveRequestedModel(undefined, "qwen")).toBe("qwen");
    expect(resolveRequestedModel("", "qwen")).toBe("qwen");
    expect(resolveRequestedModel("   ", "qwen")).toBe("qwen");
  });

  it("优先使用明确传入的模型名", () => {
    expect(resolveRequestedModel("llama3.2", "qwen")).toBe("llama3.2");
  });
});
