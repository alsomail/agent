interface Props {
  toolName: string;
  partialJson?: string;
  result?: string;
  status: "streaming" | "executing" | "completed" | "error";
  isError?: boolean;
}

export default function ToolCallBlock({ toolName, partialJson, result, status, isError }: Props) {
  const statusLabel = {
    streaming: "收集中",
    executing: "执行中",
    completed: "已完成",
    error: "失败",
  }[status];

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
        background: isError ? "rgba(248, 81, 73, 0.08)" : "rgba(125, 211, 252, 0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 12,
          color: "var(--color-text-secondary)",
          marginBottom: partialJson || result ? 8 : 0,
        }}
      >
        <strong style={{ color: "var(--color-text)" }}>{toolName}</strong>
        <span>{statusLabel}</span>
      </div>
      {partialJson ? (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {partialJson}
        </pre>
      ) : null}
      {result ? (
        <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {result}
        </div>
      ) : null}
    </div>
  );
}
