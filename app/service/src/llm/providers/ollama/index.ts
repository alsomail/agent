import type { ToolResultContentBlock, ToolUseContentBlock } from "../../types/message.js";
import type {
  LLMCompleteParams,
  LLMCompleteResult,
  LLMProvider,
  LLMStreamParams,
} from "../../types/provider.js";
import { callOllamaChatStream } from "./client.js";
import { parseOllamaStream } from "./stream-parser.js";
import type { OllamaMessage, OllamaToolDefinition } from "./types.js";

export function toOllamaMessages(messages: LLMStreamParams["messages"]): OllamaMessage[] {
  const ollamaMessages: OllamaMessage[] = [];
  const toolUseIdToName = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join(" ");
      const toolCalls = message.content
        .filter((block): block is ToolUseContentBlock => block.type === "tool_use")
        .map((block) => {
          const argumentsObject = normalizeToolArguments(block.input);
          toolUseIdToName.set(block.id, block.name);
          return {
            function: {
              name: block.name,
              arguments: argumentsObject,
            },
          };
        });

      if (text || toolCalls.length > 0) {
        ollamaMessages.push({
          role: "assistant",
          content: text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }

      continue;
    }

    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join(" ");

    if (text) {
      ollamaMessages.push({ role: "user", content: text });
    }

    const toolResults = message.content.filter(
      (block): block is ToolResultContentBlock => block.type === "tool_result",
    );
    for (const toolResult of toolResults) {
      const toolName = toolUseIdToName.get(toolResult.toolUseId);
      if (!toolName) {
        throw new Error(`Missing tool name for tool result ${toolResult.toolUseId}`);
      }

      ollamaMessages.push({
        role: "tool",
        content: toolResult.content,
        tool_name: toolName,
      });
    }
  }

  return ollamaMessages;
}

export function createOllamaProvider(config: {
  baseUrl?: string;
}): LLMProvider {
  const baseUrl = config.baseUrl ?? "http://localhost:11434";

  return {
    async *stream(params: LLMStreamParams) {
      const ollamaMessages = toOllamaMessages(params.messages);

      if (params.system) {
        ollamaMessages.unshift({ role: "system", content: params.system });
      }

      const byteStream = await callOllamaChatStream(
        {
          model: params.model,
          messages: ollamaMessages,
          stream: true,
          ...(params.tools ? { tools: toOllamaTools(params.tools) } : {}),
        },
        params.signal,
        baseUrl,
      );

      yield* parseOllamaStream(byteStream);
    },

    async complete(params: LLMCompleteParams): Promise<LLMCompleteResult> {
      const ollamaMessages = toOllamaMessages(params.messages);

      if (params.system) {
        ollamaMessages.unshift({ role: "system", content: params.system });
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: params.model,
          messages: ollamaMessages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Ollama API error: ${response.status} ${errorBody}`);
      }

      const data = (await response.json()) as {
        message?: { content?: string };
        eval_count?: number;
        prompt_eval_count?: number;
      };

      return {
        content: data.message?.content ?? "",
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
      };
    },
  };
}

function toOllamaTools(tools: NonNullable<LLMStreamParams["tools"]>): OllamaToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function normalizeToolArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be an object");
  }

  return input as Record<string, unknown>;
}
