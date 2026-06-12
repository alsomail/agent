// ── 请求体 ──
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  tools?: OllamaToolDefinition[];
  options?: {
    temperature?: number;
    top_p?: number;
  };
}

export type OllamaMessage =
  | OllamaSystemMessage
  | OllamaUserMessage
  | OllamaAssistantMessage
  | OllamaToolMessage;

export interface OllamaSystemMessage {
  role: "system";
  content: string;
}

export interface OllamaUserMessage {
  role: "user";
  content: string;
}

export interface OllamaAssistantMessage {
  role: "assistant";
  content: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaToolMessage {
  role: "tool";
  content: string;
  tool_name: string;
}

// ── 流式响应 chunk ──
export interface OllamaChunk {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: "stop" | "load" | "unload";
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

// ── 模型列表响应 ──
export interface OllamaModelEntry {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at?: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaTagsResponse {
  models: OllamaModelEntry[];
}

export interface OllamaShowResponse {
  model?: string;
  modified_at?: string;
  template?: string;
  parameters?: string;
  modelfile?: string;
  details?: Record<string, unknown>;
  model_info?: Record<string, unknown>;
}
