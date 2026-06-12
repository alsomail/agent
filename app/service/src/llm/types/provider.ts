import type { ToolDefinition } from "@myagent/protocol";
import type { NormalizedMessage } from "./message.js";
import type { NormalizedStreamEvent } from "./normalized.js";

export interface LLMProvider {
  stream(params: LLMStreamParams): AsyncIterable<NormalizedStreamEvent>;
  complete(params: LLMCompleteParams): Promise<LLMCompleteResult>;
}

export interface LLMStreamParams {
  model: string;
  messages: NormalizedMessage[];
  maxTokens: number;
  system?: string;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface LLMCompleteParams {
  model: string;
  messages: NormalizedMessage[];
  system?: string;
  maxTokens?: number;
}

export interface LLMCompleteResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMConfig {
  provider: "anthropic" | "ollama";
  apiKey?: string;
  baseUrl?: string;
}
