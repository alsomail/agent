import { zValidator } from "@hono/zod-validator";
import { CreateSessionRequestSchema } from "@myagent/protocol";
import { Hono } from "hono";
import {
  createSession,
  deleteSession,
  getMessages,
  getSession,
  listSessions,
} from "../store/session-store.js";

export const sessionRoute = new Hono();

// POST /api/session - 创建会话
sessionRoute.post("/", zValidator("json", CreateSessionRequestSchema), async (c) => {
  const body = c.req.valid("json");
  const session = await createSession({
    model: body.model,
    provider: body.provider,
    systemPrompt: body.systemPrompt,
  });
  return c.json({ success: true as const, data: session }, 201);
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
