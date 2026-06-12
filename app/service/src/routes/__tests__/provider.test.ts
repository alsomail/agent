import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { setTestDb } from "../../db/index.js";
import { runMigrations } from "../../db/migrate.js";
import * as schema from "../../db/schema.js";

const { getModelCapabilitiesMock, probeModelCapabilitiesMock, listOllamaModelsMock } = vi.hoisted(
  () => ({
    getModelCapabilitiesMock: vi.fn(),
    probeModelCapabilitiesMock: vi.fn(),
    listOllamaModelsMock: vi.fn(),
  }),
);

vi.mock("../../models/capability-probe.js", () => ({
  getModelCapabilities: getModelCapabilitiesMock,
  probeModelCapabilities: probeModelCapabilitiesMock,
}));

vi.mock("../../llm/providers/ollama/client.js", () => ({
  listOllamaModels: listOllamaModelsMock,
  hasOllamaModel: vi.fn(),
  showOllamaModel: vi.fn(),
}));

describe("providerRoute", () => {
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    setTestDb(db);
    runMigrations(db);

    listOllamaModelsMock.mockResolvedValue({
      models: [
        {
          name: "qwen3:8b",
          model: "qwen3:8b",
          size: 1,
          digest: "sha256:abc",
          modified_at: "2026-06-12T00:00:00.000Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestDb(null as unknown as ReturnType<typeof drizzle>);
  });

  it("返回带 identity 元数据的模型列表", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/api/models?provider=ollama");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: [
        {
          name: "qwen3:8b",
          displayName: "qwen3:8b",
          size: 1,
          provider: "ollama",
          model: "qwen3:8b",
          digest: "sha256:abc",
          modifiedAt: "2026-06-12T00:00:00.000Z",
        },
      ],
    });
  });

  it("查询模型能力端点返回 protocol 响应", async () => {
    getModelCapabilitiesMock.mockResolvedValue({
      capabilities: {
        identity: { provider: "ollama", name: "qwen3:8b" },
        tools: { status: "unknown", source: "none", confidence: 0 },
      },
      cacheHit: false,
    });

    const app = createApp();
    const response = await app.request(
      "http://localhost/api/model-capabilities?provider=ollama&model=qwen3%3A8b",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        capabilities: {
          identity: { provider: "ollama", name: "qwen3:8b" },
          tools: { status: "unknown", source: "none", confidence: 0 },
        },
        cacheHit: false,
      },
    });
  });

  it("手动 probe 端点强制 refresh", async () => {
    probeModelCapabilitiesMock.mockResolvedValue({
      capabilities: {
        identity: { provider: "ollama", name: "qwen3:8b" },
        tools: { status: "supported", source: "manual_refresh", confidence: 1 },
      },
      cacheHit: false,
    });

    const app = createApp();
    const response = await app.request("http://localhost/api/model-capabilities/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ollama", model: "qwen3:8b", forceRefresh: false }),
    });

    expect(response.status).toBe(200);
    expect(probeModelCapabilitiesMock).toHaveBeenCalledWith({
      provider: "ollama",
      model: "qwen3:8b",
      forceRefresh: true,
    });
  });
});
