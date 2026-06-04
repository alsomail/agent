import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../hooks/useChat.js";
import MessageBubble from "./MessageBubble.js";
import StreamingMessage from "./StreamingMessage.js";

interface Props {
  messages: ChatMessage[];
  currentText: string;
  isStreaming: boolean;
}

export default function MessageList({ messages, currentText, isStreaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling is triggered by prop changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentText]);

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
      {currentText && <StreamingMessage text={currentText} isActive={isStreaming} />}
      <div ref={bottomRef} />
    </div>
  );
}
