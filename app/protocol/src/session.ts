import { z } from "zod";
import { AgentStateEnum } from "./agent-state.js";

// 支持的 LLM Provider
export const LLMProviderEnum = z.enum(["anthropic", "openai"]);

// 支持的模型（可扩展）
export const ModelEnum = z.enum(["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]);

// 创建会话请求
export const CreateSessionRequestSchema = z.object({
  systemPrompt: z.string().optional(),
  model: ModelEnum.default("claude-sonnet-4-20250514"),
  provider: LLMProviderEnum.default("anthropic"),
});

// 会话信息（API 返回）
export const SessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  model: z.string(),
  provider: z.string(),
  messageCount: z.number(),
  state: AgentStateEnum,
});

export type LLMProvider = z.infer<typeof LLMProviderEnum>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type Session = z.infer<typeof SessionSchema>;
