import { z } from "zod";

// 内容块类型
export const TextContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ToolUseContentBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const ToolResultContentBlockSchema = z.object({
  type: z.literal("tool_result"),
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean().default(false),
});

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextContentBlockSchema,
  ToolUseContentBlockSchema,
  ToolResultContentBlockSchema,
]);

// 消息
export const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.array(ContentBlockSchema),
});

// 发送消息请求
export const SendMessageRequestSchema = z.object({
  content: z.string().min(1).max(32000),
});

// 聊天请求
export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  system: z.string().optional(),
});

export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;
export type ToolUseContentBlock = z.infer<typeof ToolUseContentBlockSchema>;
export type ToolResultContentBlock = z.infer<typeof ToolResultContentBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
