import { z } from "zod";
import { AgentStateEnum } from "./agent-state.js";

// 支持的 LLM Provider
export const LLMProviderEnum = z.enum(["anthropic", "ollama", "openai"]);

// 模型名（使用 z.string() 以支持 Ollama 等任意模型名，向后兼容之前的 enum 值）
export const ModelNameSchema = z.string().min(1);

// 创建会话请求
export const CreateSessionRequestSchema = z.object({
  systemPrompt: z.string().optional(),
  model: ModelNameSchema.default("claude-sonnet-4-20250514"),
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
