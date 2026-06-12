import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { setTestDb } from "../../db/index.js";
import { runMigrations } from "../../db/migrate.js";
import * as schema from "../../db/schema.js";
import {
  createSession,
  getMessages,
  getSession,
  updateSessionState,
} from "../../store/session-store.js";
import { logger } from "../../utils/logger.js";

const { createLLMProviderMock, runAgentLoopMock } = vi.hoisted(() => ({
  createLLMProviderMock: vi.fn(),
  runAgentLoopMock: vi.fn(),
}));

const { getModelCapabilitiesMock } = vi.hoisted(() => ({
  getModelCapabilitiesMock: vi.fn(),
}));

const { downgradeModelCapabilitiesToUnstableMock } = vi.hoisted(() => ({
  downgradeModelCapabilitiesToUnstableMock: vi.fn(),
}));

vi.mock("../../llm/providers/ollama/client.js", () => ({
  hasOllamaModel: vi.fn().mockResolvedValue(true),
  listOllamaModels: vi.fn().mockResolvedValue({ models: [] }),
  showOllamaModel: vi.fn(),
}));

vi.mock("../../llm/providers/factory.js", () => ({
  createLLMProvider: createLLMProviderMock,
}));

vi.mock("../../agent/loop.js", () => ({
  runAgentLoop: runAgentLoopMock,
}));

vi.mock("../../models/capability-probe.js", () => ({
  getModelCapabilities: getModelCapabilitiesMock,
}));

vi.mock("../../models/capability-cache.js", async () => {
  const actual = await vi.importActual<typeof import("../../models/capability-cache.js")>(
    "../../models/capability-cache.js",
  );
  return {
    ...actual,
    downgradeModelCapabilitiesToUnstable: downgradeModelCapabilitiesToUnstableMock,
  };
});

describe("chatRoute", () => {
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    setTestDb(db);
    runMigrations(db);

    createLLMProviderMock.mockReturnValue({
      stream: vi.fn(),
      complete: vi.fn(),
    });
    getModelCapabilitiesMock.mockResolvedValue({
      capabilities: {
        identity: {
          provider: "ollama",
          name: "llama3.2",
          digest: "sha256:abc",
          modifiedAt: "2026-06-12T00:00:00.000Z",
        },
        tools: { status: "supported", source: "cache", confidence: 1 },
      },
      cacheHit: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestDb(null as unknown as ReturnType<typeof drizzle>);
  });

  it("持久化 user 文本、assistant tool_use、user tool_result 和最终 assistant 文本", async () => {
    runAgentLoopMock.mockImplementation(async () => ({
      messages: [
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
          content: [
            {
              type: "tool_result",
              toolUseId: "toolu_1",
              content: "391",
              isError: false,
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "391" }],
        },
      ],
      state: "completed",
      usage: { inputTokens: 12, outputTokens: 10 },
      stopReason: "end_turn",
    }));

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "计算 17 * 23" }),
    });

    expect(response.status).toBe(200);
    await response.text();

    const messages = await getMessages(session.id);
    expect(messages).toHaveLength(4);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(JSON.parse(messages[0].content)).toEqual([{ type: "text", text: "计算 17 * 23" }]);
    expect(JSON.parse(messages[1].content)).toEqual([
      {
        type: "tool_use",
        id: "toolu_1",
        name: "calculator",
        input: { a: 17, b: 23, operator: "*" },
      },
    ]);
    expect(JSON.parse(messages[2].content)).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_1",
        content: "391",
        isError: false,
      },
    ]);
    expect(JSON.parse(messages[3].content)).toEqual([{ type: "text", text: "391" }]);
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "计算 17 * 23" }],
          },
        ],
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "calculator" }),
          expect.objectContaining({ name: "current_time" }),
        ]),
      }),
    );

    const updatedSession = await getSession(session.id);
    expect(updatedSession?.state).toBe("idle");
    expect(updatedSession?.messageCount).toBe(4);
  });

  it("非法请求返回校验错误且不写入半条消息", async () => {
    runAgentLoopMock.mockResolvedValue({
      messages: [],
      state: "completed",
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end_turn",
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });

    expect(response.status).toBe(400);
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    await response.text();

    const messages = await getMessages(session.id);
    expect(messages).toEqual([]);

    const updatedSession = await getSession(session.id);
    expect(updatedSession?.messageCount).toBe(0);
    expect(updatedSession?.state).toBe("idle");
  });

  it("会话模型不存在时直接返回错误且不写入消息", async () => {
    const { hasOllamaModel } = await import("../../llm/providers/ollama/client.js");
    vi.mocked(hasOllamaModel).mockResolvedValueOnce(false);

    const app = createApp();
    const session = await createSession({ model: "test-model", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "当前会话使用的 Ollama 模型不存在: test-model",
      },
    });
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(await getMessages(session.id)).toEqual([]);
  });

  it("能力为 unsupported 时不向 Agent Loop 传 tools", async () => {
    getModelCapabilitiesMock.mockResolvedValueOnce({
      capabilities: {
        identity: { provider: "ollama", name: "llama3.2" },
        tools: { status: "unsupported", source: "cache", confidence: 0.8 },
      },
      cacheHit: true,
    });
    runAgentLoopMock.mockResolvedValue({
      messages: [],
      state: "completed",
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end_turn",
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(runAgentLoopMock).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }));
  });

  it("能力为 unstable 时不向 Agent Loop 传 tools", async () => {
    getModelCapabilitiesMock.mockResolvedValueOnce({
      capabilities: {
        identity: { provider: "ollama", name: "llama3.2" },
        tools: { status: "unstable", source: "cache", confidence: 0.3 },
      },
      cacheHit: true,
    });
    runAgentLoopMock.mockResolvedValue({
      messages: [],
      state: "completed",
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end_turn",
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(runAgentLoopMock).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }));
  });

  it("同一会话已有进行中请求时拒绝第二个请求", async () => {
    const releaseFirstRequest = { current: () => {} };
    const firstRequestDone = new Promise<void>((resolve) => {
      releaseFirstRequest.current = resolve;
    });

    runAgentLoopMock.mockImplementation(async () => {
      await firstRequestDone;
      return {
        messages: [],
        state: "completed",
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: "end_turn",
      };
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const firstResponse = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });

    const secondResponse = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "second" }),
    });

    expect(secondResponse.status).toBe(409);
    expect(await secondResponse.json()).toEqual({
      success: false,
      error: { code: "CONFLICT", message: "当前会话已有进行中的请求" },
    });

    releaseFirstRequest.current();
    await firstResponse.text();

    const updatedSession = await getSession(session.id);
    expect(updatedSession?.state).toBe("idle");
  });

  it("数据库残留的 streaming 会话会自动恢复后继续处理", async () => {
    runAgentLoopMock.mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "你好" }] }],
      state: "completed",
      usage: { inputTokens: 3, outputTokens: 2 },
      stopReason: "end_turn",
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });
    await updateSessionState(session.id, "streaming");

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "你好" }),
    });

    expect(response.status).toBe(200);
    await response.text();

    const updatedSession = await getSession(session.id);
    expect(updatedSession?.state).toBe("idle");
  });

  it("模型只表达工具意图但未发起 tool_use 时记录诊断告警", async () => {
    const warnSpy = vi.spyOn(logger, "warn");

    runAgentLoopMock.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "我应该使用 current_time 工具来获取现在的时间。",
            },
          ],
        },
      ],
      state: "completed",
      usage: { inputTokens: 8, outputTokens: 6 },
      stopReason: "end_turn",
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "现在几点了" }),
    });

    expect(response.status).toBe(200);
    await response.text();

    expect(warnSpy).toHaveBeenCalledWith("Tool intent detected without actual tool call", {
      sessionId: session.id,
      model: "llama3.2",
      provider: "ollama",
      stopReason: "end_turn",
      matchedTools: ["current_time"],
      preview: "我应该使用 current_time 工具来获取现在的时间。",
    });
    expect(downgradeModelCapabilitiesToUnstableMock).toHaveBeenCalledWith({
      identity: {
        provider: "ollama",
        name: "llama3.2",
        digest: "sha256:abc",
        modifiedAt: "2026-06-12T00:00:00.000Z",
      },
      reason:
        "Model mentioned tool usage in text during chat but returned no structured tool_calls.",
    });
  });

  it("匹配中文调用工具名句式时也记录诊断告警", async () => {
    const warnSpy = vi.spyOn(logger, "warn");

    runAgentLoopMock.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: '用户又说"继续"，看来他们想让我继续执行获取当前时间的操作。我应该调用 current_time 工具。',
            },
          ],
        },
      ],
      state: "completed",
      usage: { inputTokens: 9, outputTokens: 7 },
      stopReason: "end_turn",
    });

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "继续" }),
    });

    expect(response.status).toBe(200);
    await response.text();

    expect(warnSpy).toHaveBeenCalledWith("Tool intent detected without actual tool call", {
      sessionId: session.id,
      model: "llama3.2",
      provider: "ollama",
      stopReason: "end_turn",
      matchedTools: ["current_time"],
      preview:
        '用户又说"继续"，看来他们想让我继续执行获取当前时间的操作。我应该调用 current_time 工具。',
    });
  });
});
