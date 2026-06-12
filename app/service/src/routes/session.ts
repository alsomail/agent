import { zValidator } from "@hono/zod-validator";
import { CreateSessionRequestSchema, UpdateSessionRequestSchema } from "@myagent/protocol";
import { Hono } from "hono";
import { config } from "../config.js";
import { hasOllamaModel } from "../llm/providers/ollama/client.js";
import {
  createSession,
  deleteSession,
  getMessages,
  getSession,
  listSessions,
  updateSessionConfig,
} from "../store/session-store.js";

export const sessionRoute = new Hono();

async function validateSessionModel(provider: string, model: string) {
  if (provider === "anthropic" && !config.isAnthropicConfigured) {
    return {
      status: 400 as const,
      body: {
        success: false as const,
        error: {
          code: "VALIDATION_ERROR",
          message: "Anthropic Provider 未配置 API Key",
        },
      },
    };
  }

  if (provider !== "ollama") {
    return null;
  }

  try {
    const matched = await hasOllamaModel(model, config.ollamaBaseUrl);
    if (!matched) {
      return {
        status: 400 as const,
        body: {
          success: false as const,
          error: {
            code: "VALIDATION_ERROR",
            message: `Ollama 模型不存在: ${model}`,
          },
        },
      };
    }
  } catch (error) {
    return {
      status: 502 as const,
      body: {
        success: false as const,
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "无法连接 Ollama 服务",
        },
      },
    };
  }

  return null;
}

// POST /api/session - 创建会话
sessionRoute.post("/", zValidator("json", CreateSessionRequestSchema), async (c) => {
  const body = c.req.valid("json");

  const validationError = await validateSessionModel(body.provider, body.model);
  if (validationError) {
    return c.json(validationError.body, validationError.status);
  }

  const session = await createSession({
    model: body.model,
    provider: body.provider,
    systemPrompt: body.systemPrompt,
  });
  return c.json({ success: true as const, data: session }, 201);
});

sessionRoute.patch("/:id", zValidator("json", UpdateSessionRequestSchema), async (c) => {
  const { id } = c.req.param();
  const body = c.req.valid("json");
  const session = await getSession(id);

  if (!session) {
    return c.json(
      { success: false as const, error: { code: "NOT_FOUND", message: "会话不存在" } },
      404,
    );
  }

  if (session.state !== "idle" && session.state !== "completed" && session.state !== "error") {
    return c.json(
      {
        success: false as const,
        error: { code: "CONFLICT", message: "当前会话正在处理中，暂不可修改模型" },
      },
      409,
    );
  }

  const nextProvider = body.provider ?? session.provider;
  const nextModel = body.model ?? session.model;

  const validationError = await validateSessionModel(nextProvider, nextModel);
  if (validationError) {
    return c.json(validationError.body, validationError.status);
  }

  const updated = await updateSessionConfig(id, {
    provider: body.provider,
    model: body.model,
    systemPrompt: body.systemPrompt,
  });

  return c.json({ success: true as const, data: updated });
});

// GET /api/sessions - 会话列表（侧边栏用）
sessionRoute.get("/", async (c) => {
  const list = await listSessions();
  return c.json({ success: true as const, data: list });
});

// GET /api/session/:id - 获取会话
sessionRoute.get("/:id", async (c) => {
  const { id } = c.req.param();
  const session = await getSession(id);
  if (!session) {
    return c.json(
      { success: false as const, error: { code: "NOT_FOUND", message: "会话不存在" } },
      404,
    );
  }
  return c.json({ success: true as const, data: session });
});

// GET /api/session/:id/messages - 消息历史
sessionRoute.get("/:id/messages", async (c) => {
  const { id } = c.req.param();
  const session = await getSession(id);
  if (!session) {
    return c.json(
      { success: false as const, error: { code: "NOT_FOUND", message: "会话不存在" } },
      404,
    );
  }
  const msgs = await getMessages(id);
  return c.json({ success: true as const, data: msgs });
});

// DELETE /api/session/:id - 删除会话
sessionRoute.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const session = await getSession(id);
  if (!session) {
    return c.json(
      { success: false as const, error: { code: "NOT_FOUND", message: "会话不存在" } },
      404,
    );
  }
  await deleteSession(id);
  return c.json({ success: true as const, data: null });
});
