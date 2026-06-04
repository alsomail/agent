import { zValidator } from "@hono/zod-validator";
import { CreateSessionRequestSchema } from "@myagent/protocol";
import type { Session } from "@myagent/protocol";
import { Hono } from "hono";
import { sessionStore, systemPromptStore } from "../store/session-store.js";

export const sessionRoute = new Hono();

// POST /api/session - 创建会话
sessionRoute.post("/", zValidator("json", CreateSessionRequestSchema), (c) => {
  const body = c.req.valid("json");
  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    model: body.model,
    provider: body.provider,
    messageCount: 0,
    state: "idle",
  };
  sessionStore.set(session.id, session);

  // 保存 systemPrompt 供后续 chat 使用
  if (body.systemPrompt) {
    systemPromptStore.set(session.id, body.systemPrompt);
  }

  return c.json({ success: true as const, data: session }, 201);
});

// GET /api/session/:id - 获取会话
sessionRoute.get("/:id", (c) => {
  const { id } = c.req.param();
  const session = sessionStore.get(id);
  if (!session) {
    return c.json(
      {
        success: false as const,
        error: { code: "NOT_FOUND", message: "会话不存在" },
      },
      404,
    );
  }
  return c.json({ success: true as const, data: session });
});

// DELETE /api/session/:id - 终止会话
sessionRoute.delete("/:id", (c) => {
  const { id } = c.req.param();
  const session = sessionStore.get(id);
  if (!session) {
    return c.json(
      {
        success: false as const,
        error: { code: "NOT_FOUND", message: "会话不存在" },
      },
      404,
    );
  }
  sessionStore.delete(id);
  systemPromptStore.delete(id);
  return c.json({ success: true as const, data: null });
});
