export interface NormalizedMessage {
  role: "user" | "assistant";
  content: NormalizedContentBlock[];
}

export type NormalizedContentBlock =
  | TextContentBlock
  | ToolUseContentBlock // Phase 3 用到
  | ToolResultContentBlock; // Phase 3 用到

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultContentBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError: boolean;
}
