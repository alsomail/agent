import { z } from "zod";
import { AgentStateEnum } from "./agent-state.js";

// 创建会话请求
export const CreateSessionRequestSchema = z.object({
  systemPrompt: z.string().optional(),
  model: z.string().default("claude-sonnet-4-5-20250929"),
  tools: z.array(z.string()).optional(),
});

// 会话信息
export const SessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messageCount: z.number(),
  state: AgentStateEnum,
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type Session = z.infer<typeof SessionSchema>;
