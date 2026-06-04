// NormalizedStreamEvent —— 归一化流事件
// Anthropic 和 OpenAI 的原始 SSE 事件都映射到此类型

export type NormalizedStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | TextDeltaEvent
  | ToolCallDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ErrorEvent;

// 每个事件的具体结构：

export interface MessageStartEvent {
  type: "message_start";
  messageId: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  blockType: "text" | "tool_use";
  toolCall?: { id: string; name: string }; // 仅当 blockType === "tool_use"
}

export interface TextDeltaEvent {
  type: "text_delta";
  index: number;
  text: string;
}

export interface ToolCallDeltaEvent {
  type: "tool_call_delta";
  index: number;
  partialJson: string;
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  usage: { outputTokens: number };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export interface ErrorEvent {
  type: "error";
  error: { type: string; message: string };
}
