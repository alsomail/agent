import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelCapabilities, probeModelCapabilities } from "../client.js";

describe("model capability api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("查询能力接口解析 data 包装", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            capabilities: {
              identity: { provider: "ollama", name: "qwen3:8b" },
              tools: { status: "unknown", source: "none", confidence: 0 },
            },
            cacheHit: false,
          },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchModelCapabilities("ollama", "qwen3:8b");

    expect(result.capabilities.tools.status).toBe("unknown");
    expect(result.cacheHit).toBe(false);
  });

  it("手动探测接口发送 forceRefresh 请求体", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            capabilities: {
              identity: { provider: "ollama", name: "qwen3:8b" },
              tools: { status: "supported", source: "manual_refresh", confidence: 1 },
            },
            cacheHit: false,
          },
        }),
        { status: 200 },
      ),
    );

    await probeModelCapabilities("ollama", "qwen3:8b");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/model-capabilities/probe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "ollama", model: "qwen3:8b", forceRefresh: true }),
      }),
    );
  });
});
