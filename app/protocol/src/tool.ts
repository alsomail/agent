import { z } from "zod";

// 工具定义（服务端注册用）
// 注意：运行时工具定义包含 execute 函数，这里只定义可序列化的部分
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const ToolResultSchema = z.object({
  toolUseId: z.string(),
  content: z.string(),
  isError: z.boolean().default(false),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
