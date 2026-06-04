import { useState } from "react";

export default function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{ id: string; role: string; content: string }>>(
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMsg = { id: crypto.randomUUID(), role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch("/api/session/default/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: [{ type: "text", text: input }] }],
        }),
      });

      // Phase 1 即将实现 SSE 流式解析
      const text = await response.text();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: text },
      ]);
    } catch (err) {
      console.error("发送失败:", err);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
      }}
    >
      <header
        style={{
          padding: "16px 0",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>🤖 MyAgent</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
          AI Agent Playground — Phase 1 脚手架
        </p>
      </header>

      <main style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: 64, color: "var(--color-text-secondary)" }}>
            输入消息开始对话
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: "var(--radius-md)",
              background: msg.role === "user" ? "var(--color-surface)" : "transparent",
              border: msg.role === "assistant" ? "1px solid var(--color-border)" : "none",
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
              {msg.role === "user" ? "👤 你" : "🤖 Agent"}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {msg.content}
            </div>
          </div>
        ))}
      </main>

      <footer style={{ padding: "16px 0", borderTop: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="输入消息..."
            disabled={isStreaming}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            style={{
              padding: "10px 20px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: isStreaming ? "var(--color-border)" : "var(--color-accent)",
              color: isStreaming ? "var(--color-text-secondary)" : "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: isStreaming ? "not-allowed" : "pointer",
            }}
          >
            {isStreaming ? "..." : "发送"}
          </button>
        </div>
      </footer>
    </div>
  );
}
