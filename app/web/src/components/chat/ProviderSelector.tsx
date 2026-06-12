import type { LLMProvider, ProviderInfo } from "@myagent/protocol";

interface Props {
  providers: ProviderInfo[];
  selected: LLMProvider;
  onSelect: (providerId: LLMProvider) => void;
  disabled?: boolean;
}

export default function ProviderSelector({
  providers,
  selected,
  onSelect,
  disabled = false,
}: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <label
        htmlFor="provider-select"
        style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}
      >
        提供:
      </label>
      <select
        id="provider-select"
        value={selected}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value as LLMProvider)}
        style={{
          padding: "4px 8px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: 13,
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.available}>
            {p.name} {!p.available ? "(不可用)" : ""}
          </option>
        ))}
      </select>
      {!providers.find((p) => p.id === selected)?.available && (
        <span style={{ fontSize: 12, color: "var(--color-warning)" }}>
          {providers.find((p) => p.id === selected)?.description}
        </span>
      )}
    </div>
  );
}
