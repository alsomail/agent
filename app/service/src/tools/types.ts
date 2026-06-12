import type { ToolDefinition, ToolInputSchema, ToolResult } from "@myagent/protocol";

export interface ToolExecutionContext {
  sessionId: string;
  signal?: AbortSignal;
}

export interface ToolExecutionResult extends Omit<ToolResult, "toolUseId"> {}

export interface ToolExecutor {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export function toToolDefinition(tool: ToolExecutor): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}
