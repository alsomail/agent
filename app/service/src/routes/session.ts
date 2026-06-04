import { zValidator } from "@hono/zod-validator";
import { CreateSessionRequestSchema } from "@myagent/protocol";
import type { Session } from "@myagent/protocol";
import { Hono } from "hono";

export const sessionRoute = new Hono();

// 内存存储（Phase 2 会改为持久化存储）
const sessions = new Map<string, Session>();

// POST /api/session - 创建会话
sessionRoute.post("/", zValidator("json", CreateSessionRequestSchema), (c) => {
  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    state: "idle",
  };
  sessions.set(session.id, session);
  return c.json({ success: true, data: session }, 201);
});

// GET /api/session/:id - 获取会话
sessionRoute.get("/:id", (c) => {
  const { id } = c.req.param();
  const session = sessions.get(id);
  if (!session) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "会话不存在" } }, 404);
  }
  return c.json({ success: true, data: session });
});

// DELETE /api/session/:id - 终止会话
sessionRoute.delete("/:id", (c) => {
  const { id } = c.req.param();
  const session = sessions.get(id);
  if (!session) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "会话不存在" } }, 404);
  }
  sessions.delete(id);
  return c.json({ success: true, data: null });
});
