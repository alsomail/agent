import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestDb } from "../../db/index.js";
import { runMigrations } from "../../db/migrate.js";
import * as schema from "../../db/schema.js";
import {
  createCapabilityResult,
  createCapabilityToolState,
  getCachedModelCapabilities,
  saveModelCapabilities,
} from "../capability-cache.js";
import { getModelCapabilities, probeModelCapabilities } from "../capability-probe.js";

const listModelsMock = vi.fn();
const showModelMock = vi.fn();

describe("capability-probe", () => {
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    setTestDb(db);
    runMigrations(db);

    listModelsMock.mockResolvedValue({
      models: [
        {
          name: "qwen3:8b",
          model: "qwen3:8b",
          size: 1,
          digest: "sha256:abc",
          modified_at: "2026-06-12T00:00:00.000Z",
          details: { family: "qwen", parameter_size: "8B", quantization_level: "Q4" },
        },
      ],
    });
    showModelMock.mockResolvedValue({
      model: "qwen3:8b",
      template: "template",
      modelfile: "FROM qwen3:8b",
      parameters: "temperature 0",
      details: { family: "qwen" },
      model_info: { context_length: 8192 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestDb(null as unknown as ReturnType<typeof drizzle>);
  });

  it("缓存命中时查询接口不触发运行时 probe", async () => {
    await saveModelCapabilities({
      capabilities: createCapabilityResult(
        {
          provider: "ollama",
          name: "qwen3:8b",
          model: "qwen3:8b",
          digest: "sha256:abc",
          modifiedAt: "2026-06-12T00:00:00.000Z",
        },
        createCapabilityToolState({
          status: "supported",
          source: "runtime_probe",
          confidence: 1,
          now: new Date("2026-06-12T00:00:00.000Z"),
        }),
      ),
    });

    const runRuntimeProbe = vi.fn();
    const result = await getModelCapabilities(
      { provider: "ollama", model: "qwen3:8b", forceRefresh: false },
      {
        listModels: listModelsMock,
        showModel: showModelMock,
        runRuntimeProbe,
      },
    );

    expect(result.cacheHit).toBe(true);
    expect(result.capabilities.tools.status).toBe("supported");
    expect(runRuntimeProbe).not.toHaveBeenCalled();
  });

  it("运行时返回 structured tool call 时标记 supported", async () => {
    const result = await probeModelCapabilities(
      { provider: "ollama", model: "qwen3:8b", forceRefresh: true },
      {
        listModels: listModelsMock,
        showModel: showModelMock,
        runRuntimeProbe: vi.fn().mockResolvedValue({
          hasStructuredToolCall: true,
          text: "",
        }),
      },
    );

    expect(result.capabilities.tools.status).toBe("supported");
    expect(result.capabilities.tools.source).toBe("manual_refresh");
  });

  it("只有文本工具意图但无 tool_calls 时标记 unstable", async () => {
    const result = await probeModelCapabilities(
      { provider: "ollama", model: "qwen3:8b", forceRefresh: true },
      {
        listModels: listModelsMock,
        showModel: showModelMock,
        runRuntimeProbe: vi.fn().mockResolvedValue({
          hasStructuredToolCall: false,
          text: "I should call current_time before answering.",
        }),
      },
    );

    expect(result.capabilities.tools.status).toBe("unstable");
  });

  it("普通文本响应标记 unsupported", async () => {
    const result = await probeModelCapabilities(
      { provider: "ollama", model: "qwen3:8b", forceRefresh: true },
      {
        listModels: listModelsMock,
        showModel: showModelMock,
        runRuntimeProbe: vi.fn().mockResolvedValue({
          hasStructuredToolCall: false,
          text: "The current time is unavailable.",
        }),
      },
    );

    expect(result.capabilities.tools.status).toBe("unsupported");
  });

  it("同名模型身份变化时不应复用进行中的 probe", async () => {
    let resolveFirstProbe:
      | ((value: { hasStructuredToolCall: boolean; text: string }) => void)
      | undefined;
    const firstProbe = new Promise<{ hasStructuredToolCall: boolean; text: string }>((resolve) => {
      resolveFirstProbe = resolve;
    });
    const runRuntimeProbe = vi
      .fn<() => Promise<{ hasStructuredToolCall: boolean; text: string }>>()
      .mockImplementationOnce(() => firstProbe)
      .mockResolvedValueOnce({
        hasStructuredToolCall: false,
        text: "The current time is unavailable.",
      });

    const firstCall = probeModelCapabilities(
      { provider: "ollama", model: "qwen3:8b", forceRefresh: true },
      {
        listModels: listModelsMock,
        showModel: showModelMock,
        runRuntimeProbe,
      },
    );

    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          name: "qwen3:8b",
          model: "qwen3:8b",
          size: 1,
          digest: "sha256:def",
          modified_at: "2026-06-13T00:00:00.000Z",
          details: { family: "qwen", parameter_size: "8B", quantization_level: "Q4" },
        },
      ],
    });
    showModelMock.mockResolvedValueOnce({
      model: "qwen3:8b",
      template: "template-v2",
      modelfile: "FROM qwen3:8b\nPARAMETER top_k 40",
      parameters: "temperature 0.2",
      details: { family: "qwen" },
      model_info: { context_length: 16384 },
    });

    const secondCall = probeModelCapabilities(
      { provider: "ollama", model: "qwen3:8b", forceRefresh: true },
      {
        listModels: listModelsMock,
        showModel: showModelMock,
        runRuntimeProbe,
      },
    );

    resolveFirstProbe?.({
      hasStructuredToolCall: true,
      text: "",
    });

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
    const cachedLatest = await getCachedModelCapabilities(secondResult.capabilities.identity);

    expect(runRuntimeProbe).toHaveBeenCalledTimes(2);
    expect(firstResult.capabilities.identity.digest).toBe("sha256:abc");
    expect(secondResult.capabilities.identity.digest).toBe("sha256:def");
    expect(cachedLatest?.tools.status).toBe("unsupported");
    expect(cachedLatest?.identity.digest).toBe("sha256:def");
  });
});
