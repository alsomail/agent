import { Hono } from "hono";

export const chatRoute = new Hono();

// POST /api/session/:id/chat - SSE 流式聊天（Phase 1 核心实现）
chatRoute.post("/:id", async (c) => {
  return c.text("Phase 1: 即将实现 Agent 循环", 501);
});
