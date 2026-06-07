import type { SessionListItem } from "@myagent/protocol";

interface Props {
  session: SessionListItem;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function SessionItem({ session, isActive, onSelect, onDelete }: Props) {
  return (
    <div
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(session.id);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        fontSize: 13,
        background: isActive ? "rgba(88, 166, 255, 0.12)" : "transparent",
        border: isActive ? "1px solid rgba(88, 166, 255, 0.3)" : "1px solid transparent",
        marginBottom: 2,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
    >
      <div style={{ overflow: "hidden", flex: 1 }}>
        <div
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "var(--color-text)",
          }}
        >
          {session.title || "新对话"}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
          {session.messageCount} 条消息
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
        style={{
          background: "none",
          border: "none",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          fontSize: 14,
          padding: "2px 4px",
          borderRadius: 3,
          flexShrink: 0,
          visibility: "hidden",
          opacity: 0,
          transition: "opacity 0.15s",
        }}
        className="session-delete-btn"
        title="删除会话"
      >
        ✕
      </button>
      <style>{`
        div:hover .session-delete-btn {
          visibility: visible !important;
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
