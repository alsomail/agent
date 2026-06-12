import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaProvider, toOllamaMessages } from "../index.js";

describe("toOllamaMessages", () => {
  it("maps assistant tool_use and user tool_result into Ollama chat messages", () => {
    const messages = toOllamaMessages([
      {
        role: "user",
        content: [{ type: "text", text: "计算 17 * 23" }],
      },
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
    ]);

    expect(messages).toEqual([
      { role: "user", content: "计算 17 * 23" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "calculator",
              arguments: { a: 17, b: 23, operator: "*" },
            },
          },
        ],
      },
      {
        role: "tool",
        content: "391",
        tool_name: "calculator",
      },
    ]);
  });
});

describe("createOllamaProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends tool result to /api/chat when continuing after a tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "391" },
        eval_count: 3,
        prompt_eval_count: 8,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOllamaProvider({ baseUrl: "http://localhost:11434" });
    await provider.complete({
      model: "llama3.2",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "计算 17 * 23" }],
        },
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
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<Record<string, unknown>>;
      stream: boolean;
    };

    expect(body.messages).toEqual([
      { role: "user", content: "计算 17 * 23" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "calculator",
              arguments: { a: 17, b: 23, operator: "*" },
            },
          },
        ],
      },
      {
        role: "tool",
        content: "391",
        tool_name: "calculator",
      },
    ]);
    expect(body.stream).toBe(false);
  });
});
