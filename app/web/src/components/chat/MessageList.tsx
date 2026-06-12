import { useEffect, useRef } from "react";
import type { ChatMessage, PendingToolCall } from "../../hooks/useChat.js";
import MessageBubble from "./MessageBubble.js";
import StreamingMessage from "./StreamingMessage.js";

interface Props {
  messages: ChatMessage[];
  currentText: string;
  isStreaming: boolean;
  pendingToolCalls: PendingToolCall[];
}

export default function MessageList({
  messages,
  currentText,
  isStreaming,
  pendingToolCalls,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling is triggered by prop changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentText, pendingToolCalls]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-secondary)",
          fontSize: 14,
        }}
      >
        输入消息开始对话
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px 0",
      }}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {(currentText || pendingToolCalls.length > 0) && (
        <StreamingMessage text={currentText} isActive={isStreaming} toolCalls={pendingToolCalls} />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
