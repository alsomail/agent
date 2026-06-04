// ── 请求体 ──
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
  };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ── 流式响应 chunk ──
export interface OllamaChunk {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  done_reason?: "stop" | "load" | "unload";
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ── 模型列表响应 ──
export interface OllamaModelEntry {
  name: string;
  model: string;
  size: number;
  digest: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaTagsResponse {
  models: OllamaModelEntry[];
}
