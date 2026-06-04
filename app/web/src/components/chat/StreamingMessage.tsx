interface Props {
  text: string;
  isActive: boolean;
}

export default function StreamingMessage({ text, isActive }: Props) {
  if (!text && !isActive) return null;

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
        <div>
          {text}
          {isActive && <span className="cursor-blink">█</span>}
        </div>
      </div>
    </div>
  );
}
