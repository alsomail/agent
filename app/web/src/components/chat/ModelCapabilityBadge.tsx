import type { ModelCapabilities } from "@myagent/protocol";

export interface ModelCapabilityBadgeProps {
  capabilities: ModelCapabilities | null;
  loading: boolean;
  onProbe: () => void;
  disabled?: boolean;
}

interface BadgeViewModel {
  accentColor: string;
  actionLabel: string | null;
  description: string;
  title: string;
}

export function getModelCapabilityBadgeViewModel(
  capabilities: ModelCapabilities | null,
  loading: boolean,
): BadgeViewModel {
  if (loading) {
    return {
      accentColor: "var(--color-accent)",
      actionLabel: null,
      title: "Tools 探测中",
      description: "正在读取或探测当前模型的工具能力。",
    };
  }

  if (!capabilities) {
    return {
      accentColor: "var(--color-text-secondary)",
      actionLabel: null,
      title: "未提供能力状态",
      description: "当前 Provider 不需要额外能力探测。",
    };
  }

  switch (capabilities.tools.status) {
    case "supported":
      return {
        accentColor: "var(--color-success)",
        actionLabel: null,
        title: "Tools 可用",
        description: capabilities.tools.reason ?? "当前模型会加载工具定义。",
      };
    case "unsupported":
      return {
        accentColor: "var(--color-warning)",
        actionLabel: null,
        title: "纯文本模式",
        description: capabilities.tools.reason ?? "当前模型不支持结构化工具调用。",
      };
    case "unstable":
      return {
        accentColor: "var(--color-warning)",
        actionLabel: null,
        title: "Tools 不稳定",
        description: capabilities.tools.reason ?? "模型会表达工具意图，但没有返回真实 tool_calls。",
      };
    case "error":
      return {
        accentColor: "var(--color-error)",
        actionLabel: "重试探测",
        title: "探测失败",
        description:
          capabilities.tools.lastProbeError ?? capabilities.tools.reason ?? "模型能力探测失败。",
      };
    case "probing":
      return {
        accentColor: "var(--color-accent)",
        actionLabel: null,
        title: "Tools 探测中",
        description: "已有探测任务在进行中，请稍候。",
      };
    default:
      return {
        accentColor: "var(--color-text-secondary)",
        actionLabel: "开始探测",
        title: "Tools 状态未知",
        description: "不会自动启用工具；可手动探测后决定是否加载。",
      };
  }
}

export default function ModelCapabilityBadge({
  capabilities,
  loading,
  onProbe,
  disabled = false,
}: ModelCapabilityBadgeProps) {
  const viewModel = getModelCapabilityBadgeViewModel(capabilities, loading);
  const showAction = Boolean(viewModel.actionLabel && !loading && capabilities);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        minHeight: 40,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: viewModel.accentColor,
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <strong style={{ fontSize: 12 }}>{viewModel.title}</strong>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {viewModel.description}
        </span>
      </div>
      {showAction ? (
        <button
          type="button"
          onClick={onProbe}
          disabled={disabled}
          style={{
            marginLeft: "auto",
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.7 : 1,
          }}
        >
          {viewModel.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
