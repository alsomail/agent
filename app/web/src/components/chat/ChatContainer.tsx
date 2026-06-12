import { useEffect } from "react";
import { useChat } from "../../hooks/useChat.js";
import SessionSidebar from "../session/SessionSidebar.js";
import ChatInput from "./ChatInput.js";
import MessageList from "./MessageList.js";
import ModelCapabilityBadge from "./ModelCapabilityBadge.js";
import ModelSelector from "./ModelSelector.js";
import ProviderSelector from "./ProviderSelector.js";

export default function ChatContainer() {
  const {
    messages,
    isStreaming,
    currentText,
    pendingToolCalls,
    agentState,
    error,
    send,
    dismissError,
    providers,
    selectedProvider,
    selectedModel,
    modelCapabilities,
    isLoadingModelCapabilities,
    probeSelectedModelCapabilities,
    setSelectedModel,
    fetchProvidersAndModels,
    handleProviderChange,
    sessions,
    sessionId,
    switchSession,
    createNewSession,
    deleteSession,
    initialize,
  } = useChat();

  // 挂载时初始化：加载 Provider + 会话列表 + 自动选择/创建会话
  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* 侧边栏 */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={sessionId}
        onSelect={switchSession}
        onDelete={deleteSession}
        onNew={() => {
          void createNewSession();
        }}
      />

      {/* 主聊天区域 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
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
            style={{
              display: "flex",
              gap: 16,
              marginTop: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <ProviderSelector
              providers={providers}
              selected={selectedProvider}
              onSelect={handleProviderChange}
              disabled={isStreaming}
            />
            {selectedProvider && (
              <ModelSelector
                provider={selectedProvider}
                selected={selectedModel}
                onSelect={setSelectedModel}
                disabled={isStreaming}
              />
            )}
            {selectedProvider === "ollama" && selectedModel ? (
              <ModelCapabilityBadge
                capabilities={modelCapabilities}
                loading={isLoadingModelCapabilities}
                onProbe={() => {
                  void probeSelectedModelCapabilities();
                }}
                disabled={isStreaming}
              />
            ) : null}
          </div>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
            当前会话模型设置，修改后立即作用于当前对话
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
            {agentState === "tool_executing" ? "🛠️ Agent 正在执行工具..." : "⏳ Agent 正在思考..."}
          </div>
        )}

        {/* Message list */}
        <MessageList
          messages={messages}
          currentText={currentText}
          isStreaming={isStreaming}
          pendingToolCalls={pendingToolCalls}
        />

        {/* Input area */}
        <footer
          style={{
            padding: "16px 0",
            borderTop: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <ChatInput onSend={send} disabled={isStreaming} status={agentState} />
        </footer>
      </div>
    </div>
  );
}
