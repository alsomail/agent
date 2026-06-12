import type { PendingToolCall } from "../../hooks/useChat.js";
import ToolCallBlock from "./ToolCallBlock.js";

interface Props {
  text: string;
  isActive: boolean;
  toolCalls: PendingToolCall[];
}

export default function StreamingMessage({ text, isActive, toolCalls }: Props) {
  if (!text && !isActive && toolCalls.length === 0) return null;

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 16 }}>
      <div
        style={{
          maxWidth: "70%",
          padding: "12px 16px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            color: "var(--color-text-secondary)",
          }}
        >
          🤖 Agent
        </div>
        <div style={{ marginBottom: toolCalls.length > 0 ? 10 : 0 }}>
          {text}
          {isActive && <span className="cursor-blink">█</span>}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {toolCalls.map((toolCall) => (
            <ToolCallBlock
              key={toolCall.toolCallId}
              toolName={toolCall.toolName}
              partialJson={toolCall.partialJson}
              status={toolCall.status}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
