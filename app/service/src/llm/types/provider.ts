import type { NormalizedMessage } from "./message.js";
import type { NormalizedStreamEvent } from "./normalized.js";

export interface LLMProvider {
  stream(params: LLMStreamParams): AsyncIterable<NormalizedStreamEvent>;
}

export interface LLMStreamParams {
  model: string;
  messages: NormalizedMessage[];
  maxTokens: number;
  system?: string;
  signal?: AbortSignal;
}

export interface LLMConfig {
  provider: "anthropic";
  apiKey: string;
  baseUrl?: string;
}
