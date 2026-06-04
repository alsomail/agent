import { useEffect } from "react";
import { useChat } from "../../hooks/useChat.js";
import ChatInput from "./ChatInput.js";
import MessageList from "./MessageList.js";
import ModelSelector from "./ModelSelector.js";
import ProviderSelector from "./ProviderSelector.js";

export default function ChatContainer() {
  const {
    messages,
    isStreaming,
    currentText,
    error,
    send,
    dismissError,
    providers,
    selectedProvider,
    selectedModel,
    setSelectedModel,
    fetchProvidersAndModels,
    handleProviderChange,
  } = useChat();

  // 挂载时拉取 Provider 列表
  useEffect(() => {
    fetchProvidersAndModels();
  }, [fetchProvidersAndModels]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        maxWidth: 800,
        margin: "0 auto",
        padding: "0 16px",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "16px 0",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>🤖 MyAgent</h1>
        <div
          style={{ display: "flex", gap: 16, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <ProviderSelector
            providers={providers}
            selected={selectedProvider}
            onSelect={handleProviderChange}
          />
          {selectedProvider && (
            <ModelSelector
              provider={selectedProvider}
              selected={selectedModel}
              onSelect={setSelectedModel}
            />
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
          AI Agent Playground — Phase 1
        </p>
      </header>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            marginTop: 8,
            borderRadius: "var(--radius-sm)",
            background: "rgba(248, 81, 73, 0.15)",
            border: "1px solid var(--color-error)",
            color: "var(--color-error)",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>❌ {error}</span>
          <button
            type="button"
            onClick={dismissError}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-error)",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Status indicator */}
      {isStreaming && !error && (
        <div
          style={{
            padding: "6px 0",
            fontSize: 13,
            color: "var(--color-accent)",
            flexShrink: 0,
          }}
        >
          ⏳ Agent 正在思考...
        </div>
      )}

      {/* Message list */}
      <MessageList messages={messages} currentText={currentText} isStreaming={isStreaming} />

      {/* Input area */}
      <footer
        style={{
          padding: "16px 0",
          borderTop: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <ChatInput onSend={send} disabled={isStreaming} />
      </footer>
    </div>
  );
}
