import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { setTestDb } from "../../db/index.js";
import { runMigrations } from "../../db/migrate.js";
import * as schema from "../../db/schema.js";
import { createSession, getSession, updateSessionState } from "../../store/session-store.js";

vi.mock("../../llm/providers/ollama/client.js", () => ({
  hasOllamaModel: vi.fn().mockResolvedValue(true),
  listOllamaModels: vi.fn().mockResolvedValue({
    models: [{ name: "llama3.2", size: 1 }],
  }),
}));

describe("sessionRoute", () => {
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    setTestDb(db);
    runMigrations(db);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestDb(null as unknown as ReturnType<typeof drizzle>);
  });

  it("允许更新当前会话的 model", async () => {
    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:latest",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        id: session.id,
        provider: "ollama",
        model: "llama3.2:latest",
      },
    });

    const updated = await getSession(session.id);
    expect(updated?.provider).toBe("ollama");
    expect(updated?.model).toBe("llama3.2:latest");
  });

  it("拒绝将会话更新为不存在的 Ollama 模型", async () => {
    const { hasOllamaModel } = await import("../../llm/providers/ollama/client.js");
    vi.mocked(hasOllamaModel).mockResolvedValueOnce(false);

    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });

    const response = await app.request(`http://localhost/api/session/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Ollama 模型不存在: test-model",
      },
    });
  });

  it("会话流式处理中时拒绝修改模型", async () => {
    const app = createApp();
    const session = await createSession({ model: "llama3.2", provider: "ollama" });
    await updateSessionState(session.id, "streaming");

    const response = await app.request(`http://localhost/api/session/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:latest",
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: {
        code: "CONFLICT",
        message: "当前会话正在处理中，暂不可修改模型",
      },
    });
  });
});
