import type { SessionListItem } from "@myagent/protocol";
import SessionItem from "./SessionItem.js";

interface Props {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onNew,
}: Props) {
  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* 新建会话按钮 */}
      <div style={{ padding: "12px" }}>
        <button
          type="button"
          onClick={onNew}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-accent)",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + 新建会话
        </button>
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
        {sessions.length === 0 ? (
          <div
            style={{
              padding: "24px 12px",
              textAlign: "center",
              fontSize: 13,
              color: "var(--color-text-secondary)",
            }}
          >
            暂无会话
          </div>
        ) : (
          sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      {/* 底部信息 */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid var(--color-border)",
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        Phase 2
      </div>
    </aside>
  );
}
