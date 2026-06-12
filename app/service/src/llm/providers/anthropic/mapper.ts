import type { NormalizedMessage } from "../../types/message.js";
import type { AnthropicMessageParam } from "./types.js";

export function toAnthropicMessages(messages: NormalizedMessage[]): AnthropicMessageParam[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content.map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text" as const, text: block.text };
        case "tool_use":
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: normalizeToolInput(block.input),
          };
        case "tool_result":
          return {
            type: "tool_result" as const,
            tool_use_id: block.toolUseId,
            content: block.content,
            ...(block.isError ? { is_error: true } : {}),
          };
        default:
          throw new Error(`Unsupported content block type: ${(block as { type: string }).type}`);
      }
    }),
  }));
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be an object");
  }

  return input as Record<string, unknown>;
}
