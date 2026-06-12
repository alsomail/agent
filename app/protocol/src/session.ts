import { z } from "zod";
import { AgentStateEnum } from "./agent-state.js";
import { StoredMessageSchema } from "./message.js";

// 当前已接入的 LLM Provider。OpenAI 是后续扩展槽，接入前不进入运行时协议。
export const LLMProviderEnum = z.enum(["anthropic", "ollama"]);

// 模型名（使用 z.string() 以支持 Ollama 等任意模型名，向后兼容之前的 enum 值）
export const ModelNameSchema = z.string().min(1);

// 创建会话请求
export const CreateSessionRequestSchema = z.object({
  systemPrompt: z.string().optional(),
  model: ModelNameSchema.default("claude-sonnet-4-20250514"),
  provider: LLMProviderEnum.default("anthropic"),
});

export const UpdateSessionRequestSchema = z
  .object({
    systemPrompt: z.string().optional(),
    model: ModelNameSchema.optional(),
    provider: LLMProviderEnum.optional(),
  })
  .refine(
    (value) =>
      value.systemPrompt !== undefined || value.model !== undefined || value.provider !== undefined,
    { message: "至少需要更新一个字段" },
  );

// 会话信息（API 返回）
export const SessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  model: z.string(),
  provider: LLMProviderEnum,
  messageCount: z.number(),
  state: AgentStateEnum,
});

export type LLMProvider = z.infer<typeof LLMProviderEnum>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>;
export type Session = z.infer<typeof SessionSchema>;

// ─── 会话列表条目（侧边栏用，不含消息体）───

export const SessionListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  model: z.string(),
  provider: LLMProviderEnum,
  messageCount: z.number(),
  title: z.string().optional(),
});

// ─── 会话详情（含消息历史）───
export const SessionDetailSchema = SessionSchema.extend({
  messages: z.array(StoredMessageSchema),
});

export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
