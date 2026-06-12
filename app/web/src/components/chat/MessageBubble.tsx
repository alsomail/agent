import type { ChatMessage } from "../../hooks/useChat.js";
import ToolCallBlock from "./ToolCallBlock.js";

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          maxWidth: "70%",
          padding: "12px 16px",
          borderRadius: "var(--radius-md)",
          background: isUser ? "var(--color-surface)" : "transparent",
          border: isUser ? "none" : "1px solid var(--color-border)",
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
          {isUser ? "👤 你" : "🤖 Agent"}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {message.content.map((block, index) => {
            if (block.type === "text") {
              return <div key={`${message.id}-${index}`}>{block.text}</div>;
            }

            if (block.type === "tool_use") {
              return (
                <ToolCallBlock
                  key={`${message.id}-${block.id}`}
                  toolName={block.name}
                  partialJson={JSON.stringify(block.input, null, 2)}
                  status="completed"
                />
              );
            }

            return (
              <ToolCallBlock
                key={`${message.id}-${block.toolUseId}`}
                toolName={block.toolUseId}
                result={block.content}
                status={block.isError ? "error" : "completed"}
                isError={block.isError}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
