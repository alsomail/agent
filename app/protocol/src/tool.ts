import { z } from "zod";

export type ToolJsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: Array<string | number | boolean | null>;
  properties?: Record<string, ToolJsonSchema>;
  required?: string[];
  items?: ToolJsonSchema;
  additionalProperties?: boolean | ToolJsonSchema;
  default?: unknown;
};

export const ToolJsonSchemaSchema: z.ZodType<ToolJsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum(["object", "string", "number", "integer", "boolean", "array"]).optional(),
      description: z.string().optional(),
      enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      properties: z.record(ToolJsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: ToolJsonSchemaSchema.optional(),
      additionalProperties: z.union([z.boolean(), ToolJsonSchemaSchema]).optional(),
      default: z.unknown().optional(),
    })
    .strict(),
);

export const ToolInputSchemaSchema = z
  .object({
    type: z.literal("object"),
    description: z.string().optional(),
    properties: z.record(ToolJsonSchemaSchema).default({}),
    required: z.array(z.string()).default([]),
    additionalProperties: z.union([z.boolean(), ToolJsonSchemaSchema]).default(false),
  })
  .strict();

export const ToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "工具名必须以小写字母开头，只能包含小写字母、数字和下划线");

// 工具定义（跨端可见、可序列化）
// 注意：运行时工具定义包含 execute 函数，execute 只能存在于 service 内部。
export const ToolDefinitionSchema = z.object({
  name: ToolNameSchema,
  description: z.string().min(1).max(1024),
  inputSchema: ToolInputSchemaSchema,
});

export const ToolCallSchema = z.object({
  id: z.string(),
  name: ToolNameSchema,
  input: z.record(z.string(), z.unknown()),
});

export const ToolResultSchema = z.object({
  toolUseId: z.string(),
  content: z.string().max(32000),
  isError: z.boolean().default(false),
});

export type ToolInputSchema = z.infer<typeof ToolInputSchemaSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
