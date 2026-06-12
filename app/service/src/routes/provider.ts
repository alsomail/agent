import { zValidator } from "@hono/zod-validator";
import {
  ModelCapabilityProbeRequestSchema,
  type ModelInfo,
  ModelListQuerySchema,
  type ProviderInfo,
} from "@myagent/protocol";
import { Hono } from "hono";
import { config } from "../config.js";
import { listOllamaModels } from "../llm/providers/ollama/client.js";
import { getModelCapabilities, probeModelCapabilities } from "../models/capability-probe.js";

export const providerRoute = new Hono();

// GET /api/providers - 返回可用的 Provider 列表
providerRoute.get("/providers", async (c) => {
  const providers: ProviderInfo[] = [];

  // Ollama
  let ollamaAvailable = false;
  try {
    await listOllamaModels(config.ollamaBaseUrl);
    ollamaAvailable = true;
  } catch {
    ollamaAvailable = false;
  }

  providers.push({
    id: "ollama",
    name: "Ollama (本地)",
    available: ollamaAvailable,
    description: ollamaAvailable ? "本地模型，无需 API Key" : "Ollama 服务未运行",
  });

  // Anthropic
  providers.push({
    id: "anthropic",
    name: "Anthropic",
    available: config.isAnthropicConfigured,
    description: config.isAnthropicConfigured
      ? "已配置 API Key"
      : "未配置 API Key（在 .env 中设置 ANTHROPIC_API_KEY）",
  });

  return c.json({ providers });
});

// GET /api/models?provider=ollama - 返回指定 Provider 的模型列表
providerRoute.get("/models", zValidator("query", ModelListQuerySchema), async (c) => {
  c.req.valid("query");

  try {
    const tags = await listOllamaModels(config.ollamaBaseUrl);
    const models: ModelInfo[] = tags.models.map((m) => ({
      name: m.name,
      displayName: m.name.replace(":latest", ""),
      size: m.size,
      provider: "ollama" as const,
      model: m.model,
      digest: m.digest,
      modifiedAt: m.modified_at,
    }));

    return c.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ollama 服务不可达";
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message } }, 502);
  }
});

providerRoute.get(
  "/model-capabilities",
  zValidator("query", ModelCapabilityProbeRequestSchema.omit({ forceRefresh: true })),
  async (c) => {
    try {
      const result = await getModelCapabilities({
        ...c.req.valid("query"),
        forceRefresh: false,
      });
      return c.json({ success: true as const, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "查询模型能力失败";
      return c.json({ success: false as const, error: { code: "INTERNAL_ERROR", message } }, 502);
    }
  },
);

providerRoute.post(
  "/model-capabilities/probe",
  zValidator("json", ModelCapabilityProbeRequestSchema),
  async (c) => {
    try {
      const result = await probeModelCapabilities({
        ...c.req.valid("json"),
        forceRefresh: true,
      });
      return c.json({ success: true as const, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "探测模型能力失败";
      return c.json({ success: false as const, error: { code: "INTERNAL_ERROR", message } }, 502);
    }
  },
);
