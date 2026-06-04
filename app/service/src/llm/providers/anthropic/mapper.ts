import type { NormalizedMessage } from "../../types/message.js";
import type { AnthropicMessageParam } from "./types.js";

export function toAnthropicMessages(messages: NormalizedMessage[]): AnthropicMessageParam[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content.map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text" as const, text: block.text };
        default:
          throw new Error(`Unsupported content block type: ${(block as { type: string }).type}`);
      }
    }),
  }));
}
